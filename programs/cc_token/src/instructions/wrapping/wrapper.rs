use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::{
    constants::{STATE_VERSION, WRAPPER_MINT_SEED, WRAPPER_SEED},
    instructions::positions::validate_position_identity,
    prelude::*,
};

pub fn validate_wrapper(
    position_address: &Pubkey,
    position: &PositionDefinition,
    wrapper_address: &Pubkey,
    wrapper: &WrapperConfig,
    mint: &InterfaceAccount<Mint>,
) -> CcTokenResult {
    validate_position_identity(position_address, position)?;
    let (expected_wrapper, wrapper_bump) =
        Pubkey::find_program_address(&[WRAPPER_SEED, position.position_id.as_ref()], &crate::ID);
    let (expected_mint, mint_bump) = Pubkey::find_program_address(
        &[WRAPPER_MINT_SEED, position.position_id.as_ref()],
        &crate::ID,
    );
    require!(
        *wrapper_address == expected_wrapper
            && wrapper.version == STATE_VERSION
            && wrapper.position_id == position.position_id
            && wrapper.mint == expected_mint
            && wrapper.bump == wrapper_bump
            && wrapper.mint_bump == mint_bump,
        CcTokenError::WrapperMismatch
    );
    require!(
        mint.key() == expected_mint
            && mint.decimals == wrapper.decimals
            && mint.mint_authority == Some(expected_wrapper).into()
            && mint.freeze_authority.is_none(),
        CcTokenError::WrapperMintMismatch
    );
    require_keys_eq!(
        *mint.to_account_info().owner,
        anchor_spl::token_2022::ID,
        CcTokenError::WrapperMintMismatch
    );
    Ok(())
}
