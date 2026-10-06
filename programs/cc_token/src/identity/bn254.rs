use anchor_lang::{error, require};
use solana_bn254::{
    compression::prelude::alt_bn128_g1_decompress_be, prelude::alt_bn128_g1_addition_be,
};

use crate::{constants::ROOT_COLLECTION_ID, math::IndexSet, prelude::*};

const BASE_FIELD_MODULUS: [u64; 4] = [
    4_332_616_871_279_656_263,
    10_917_124_144_477_883_021,
    13_281_191_951_274_694_749,
    3_486_998_266_802_970_665,
];

pub struct DerivedCollection {
    pub collection_id: [u8; 32],
    pub hash_attempts: u32,
}

pub fn derive_collection_id(
    parent_collection_id: [u8; 32],
    condition_id: [u8; 32],
    index_set: IndexSet,
) -> CcTokenResult<DerivedCollection> {
    let (atomic_point, hash_attempts) = derive_atomic_point(condition_id, index_set);
    let atomic_point = atomic_point?;
    let collection_point = if parent_collection_id == ROOT_COLLECTION_ID {
        atomic_point
    } else {
        add_points(decode_collection_id(parent_collection_id)?, atomic_point)?
    };
    let collection_id = encode_collection_id(collection_point);
    require!(
        collection_id != ROOT_COLLECTION_ID,
        CcTokenError::IdentityPoint
    );

    Ok(DerivedCollection {
        collection_id,
        hash_attempts,
    })
}

pub fn decode_collection_id(mut collection_id: [u8; 32]) -> CcTokenResult<[u8; 64]> {
    require!(
        collection_id != ROOT_COLLECTION_ID,
        CcTokenError::InvalidCollectionPoint
    );
    require!(
        collection_id[0] & 0x80 == 0,
        CcTokenError::InvalidCollectionPoint
    );

    let odd = collection_id[0] & 0x40 != 0;
    collection_id[0] &= 0x3f;
    collection_id[0] |= 0x80;
    let point = alt_bn128_g1_decompress_be(&collection_id)
        .map_err(|_| error!(CcTokenError::InvalidCollectionPoint))?;
    select_y_parity(point, odd).ok_or_else(|| error!(CcTokenError::InvalidCollectionPoint))
}

pub fn encode_collection_id(point: [u8; 64]) -> [u8; 32] {
    let mut collection_id = [0; 32];
    collection_id.copy_from_slice(&point[..32]);
    collection_id[0] |= (point[63] & 1) << 6;
    collection_id
}

fn derive_atomic_point(
    condition_id: [u8; 32],
    index_set: IndexSet,
) -> (CcTokenResult<[u8; 64]>, u32) {
    let index_set = index_set.to_be_bytes();
    let hash = solana_keccak_hasher::hashv(&[&condition_id, &index_set]).to_bytes();
    let odd = hash[0] & 0x80 != 0;
    let mut x = reduce(from_be_bytes(&hash));
    let mut attempts = 0u32;

    loop {
        x = increment(x);
        attempts = attempts.saturating_add(1);
        let mut candidate = to_be_bytes(x);
        candidate[0] |= 0x80;
        if let Ok(point) = alt_bn128_g1_decompress_be(&candidate) {
            let point = select_y_parity(point, odd)
                .ok_or_else(|| error!(CcTokenError::CurveOperationFailed));
            return (point, attempts);
        }
    }
}

fn add_points(left: [u8; 64], right: [u8; 64]) -> CcTokenResult<[u8; 64]> {
    let mut input = [0; 128];
    input[..64].copy_from_slice(&left);
    input[64..].copy_from_slice(&right);
    let result =
        alt_bn128_g1_addition_be(&input).map_err(|_| error!(CcTokenError::CurveOperationFailed))?;
    result
        .try_into()
        .map_err(|_| error!(CcTokenError::CurveOperationFailed))
}

fn select_y_parity(mut point: [u8; 64], odd: bool) -> Option<[u8; 64]> {
    if (point[63] & 1 != 0) != odd {
        let (y, underflow) = subtract(BASE_FIELD_MODULUS, from_be_bytes(&point[32..]));
        if underflow {
            return None;
        }
        point[32..].copy_from_slice(&to_be_bytes(y));
    }
    Some(point)
}

fn from_be_bytes(bytes: &[u8]) -> [u64; 4] {
    core::array::from_fn(|index| {
        let start = (3 - index) * 8;
        u64::from_be_bytes(bytes[start..start + 8].try_into().unwrap())
    })
}

fn to_be_bytes(limbs: [u64; 4]) -> [u8; 32] {
    let mut bytes = [0; 32];
    for (index, limb) in limbs.iter().enumerate() {
        let start = (3 - index) * 8;
        bytes[start..start + 8].copy_from_slice(&limb.to_be_bytes());
    }
    bytes
}

fn subtract(left: [u64; 4], right: [u64; 4]) -> ([u64; 4], bool) {
    let mut result = [0; 4];
    let mut borrow = false;
    for index in 0..4 {
        let (value, first_borrow) = left[index].overflowing_sub(right[index]);
        let (value, second_borrow) = value.overflowing_sub(u64::from(borrow));
        result[index] = value;
        borrow = first_borrow || second_borrow;
    }
    (result, borrow)
}

fn reduce(mut value: [u64; 4]) -> [u64; 4] {
    loop {
        let (reduced, underflow) = subtract(value, BASE_FIELD_MODULUS);
        if underflow {
            return value;
        }
        value = reduced;
    }
}

fn increment(mut value: [u64; 4]) -> [u64; 4] {
    for limb in &mut value {
        let (incremented, overflow) = limb.overflowing_add(1);
        *limb = incremented;
        if !overflow {
            break;
        }
    }
    reduce(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bytes(value: &str) -> [u8; 32] {
        assert_eq!(value.len(), 64);
        let mut result = [0; 32];
        for (index, byte) in result.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).unwrap();
        }
        result
    }

    #[test]
    fn gnosis_collection_id_fixture() {
        let condition_id =
            bytes("67eb23e8932765c1d7a094838c928476df8c50d1d3898f278ef1fb2a62afab63");
        let expected = bytes("229b067e142fce0aea84afb935095c6ecbea8647b8a013e795cc0ced3210a3d5");
        let actual = derive_collection_id(
            ROOT_COLLECTION_ID,
            condition_id,
            IndexSet {
                words: [3, 0, 0, 0],
            },
        )
        .unwrap();

        assert_eq!(actual.collection_id, expected);
        assert!(actual.hash_attempts > 0);
    }

    #[test]
    fn codec_round_trip_preserves_gnosis_encoding() {
        let collection_id =
            bytes("229b067e142fce0aea84afb935095c6ecbea8647b8a013e795cc0ced3210a3d5");
        let point = decode_collection_id(collection_id).unwrap();
        assert_eq!(encode_collection_id(point), collection_id);
    }

    #[test]
    fn composition_is_commutative() {
        let condition_a = [3; 32];
        let condition_b = [5; 32];
        let index_a = IndexSet {
            words: [1, 0, 0, 0],
        };
        let index_b = IndexSet {
            words: [2, 0, 0, 0],
        };
        let atomic_a = derive_collection_id(ROOT_COLLECTION_ID, condition_a, index_a)
            .unwrap()
            .collection_id;
        let atomic_b = derive_collection_id(ROOT_COLLECTION_ID, condition_b, index_b)
            .unwrap()
            .collection_id;

        let a_then_b = derive_collection_id(atomic_a, condition_b, index_b)
            .unwrap()
            .collection_id;
        let b_then_a = derive_collection_id(atomic_b, condition_a, index_a)
            .unwrap()
            .collection_id;

        assert_eq!(a_then_b, b_then_a);
    }

    #[test]
    fn repeated_factor_changes_the_collection() {
        let condition_id = [11; 32];
        let index_set = IndexSet {
            words: [1, 0, 0, 0],
        };
        let once = derive_collection_id(ROOT_COLLECTION_ID, condition_id, index_set)
            .unwrap()
            .collection_id;
        let twice = derive_collection_id(once, condition_id, index_set)
            .unwrap()
            .collection_id;

        assert_ne!(once, twice);
        assert_eq!(
            encode_collection_id(decode_collection_id(twice).unwrap()),
            twice
        );
    }

    #[test]
    fn root_is_not_a_curve_point() {
        assert!(decode_collection_id(ROOT_COLLECTION_ID).is_err());
    }
}
