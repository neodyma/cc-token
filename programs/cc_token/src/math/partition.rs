use anchor_lang::prelude::*;

use crate::prelude::*;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ValidatedPartition {
    pub union: IndexSet,
    pub is_full: bool,
}

pub fn validate_partition(
    outcome_count: u16,
    partition: &[IndexSet],
) -> CcTokenResult<ValidatedPartition> {
    let universe = IndexSet::universe(outcome_count)?;
    require!(partition.len() >= 2, CcTokenError::PartitionTooSmall);
    let mut union = IndexSet::ZERO;

    for subset in partition {
        subset.validate(outcome_count)?;
        require!(!union.overlaps(*subset), CcTokenError::PartitionOverlap);
        union = union.union(*subset);
    }

    Ok(ValidatedPartition {
        union,
        is_full: union == universe,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index_set(bits: &[u16]) -> IndexSet {
        let mut words = [0; 4];
        for bit in bits {
            words[usize::from(bit / 64)] |= 1 << (bit % 64);
        }
        IndexSet { words }
    }

    #[test]
    fn accepts_full_and_partial_partitions() {
        let full = validate_partition(3, &[index_set(&[0, 1]), index_set(&[2])]).unwrap();
        assert_eq!(full.union, IndexSet::universe(3).unwrap());
        assert!(full.is_full);

        let partial = validate_partition(8, &[index_set(&[0, 1]), index_set(&[4])]).unwrap();
        assert_eq!(partial.union, index_set(&[0, 1, 4]));
        assert!(!partial.is_full);
    }

    #[test]
    fn accepts_boundaries_for_every_supported_arity_class() {
        for (outcome_count, upper_outcome) in [(2, 1), (3, 2), (16, 15), (255, 254), (256, 255)] {
            assert!(validate_partition(
                outcome_count,
                &[index_set(&[0]), index_set(&[upper_outcome])]
            )
            .is_ok());
        }

        let boundaries = [0, 63, 64, 127, 128, 191, 192, 255].map(|outcome| index_set(&[outcome]));
        assert!(validate_partition(256, &boundaries).is_ok());
    }

    #[test]
    fn rejects_invalid_partition_shapes() {
        assert!(validate_partition(8, &[]).is_err());
        assert!(validate_partition(8, &[index_set(&[0])]).is_err());
        assert!(validate_partition(8, &[index_set(&[0, 1]), index_set(&[1, 2])]).is_err());
        assert!(validate_partition(8, &[index_set(&[0]), index_set(&[0])]).is_err());
        assert!(validate_partition(8, &[IndexSet::ZERO, index_set(&[0])]).is_err());
        assert!(validate_partition(
            8,
            &[index_set(&(0..8).collect::<Vec<_>>()), index_set(&[0])]
        )
        .is_err());
        assert!(validate_partition(8, &[index_set(&[0]), index_set(&[8])]).is_err());
    }

    #[test]
    fn accepts_a_full_256_singleton_partition() {
        let partition = (0..256)
            .map(|outcome| index_set(&[outcome]))
            .collect::<Vec<_>>();
        let validated = validate_partition(256, &partition).unwrap();

        assert_eq!(validated.union, IndexSet::universe(256).unwrap());
        assert!(validated.is_full);
    }
}
