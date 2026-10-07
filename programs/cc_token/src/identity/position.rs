use anchor_lang::prelude::*;

use crate::{
    constants::{POSITION_ID_DOMAIN, ROOT_COLLECTION_ID},
    prelude::*,
};

pub fn derive_position_id(
    collateral_mint: &Pubkey,
    collection_id: [u8; 32],
) -> CcTokenResult<[u8; 32]> {
    require!(
        collection_id != ROOT_COLLECTION_ID,
        CcTokenError::RootPosition
    );
    Ok(
        solana_keccak_hasher::hashv(&[
            POSITION_ID_DOMAIN,
            collateral_mint.as_ref(),
            &collection_id,
        ])
        .to_bytes(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collateral_and_collection_both_scope_the_position() {
        let collection_id = [3; 32];
        let position_id =
            derive_position_id(&Pubkey::new_from_array([5; 32]), collection_id).unwrap();

        assert_ne!(
            position_id,
            derive_position_id(&Pubkey::new_from_array([6; 32]), collection_id).unwrap()
        );
        assert_ne!(
            position_id,
            derive_position_id(&Pubkey::new_from_array([5; 32]), [4; 32]).unwrap()
        );
        assert!(derive_position_id(&Pubkey::new_from_array([5; 32]), ROOT_COLLECTION_ID).is_err());
    }
}
