use anchor_lang::{prelude::*, system_program};
use anchor_spl::token_interface::{
    spl_pod::optional_keys::OptionalNonZeroPubkey,
    spl_token_metadata_interface::state::{Field, TokenMetadata},
    token_metadata_initialize, token_metadata_update_field, Mint, TokenMetadataInitialize,
    TokenMetadataUpdateField,
};

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

pub const WRAPPER_METADATA_NAME_PREFIX: &str = "CC-T #";
pub const WRAPPER_METADATA_SYMBOL: &str = "CCP";
pub const WRAPPER_METADATA_POSITION_ID: &str = "position_id";
pub const WRAPPER_METADATA_COLLECTION_ID: &str = "collection_id";
pub const WRAPPER_METADATA_COLLATERAL_MINT: &str = "collateral_mint";
// Hex characters of the position ID shown in the token's name.
const NAME_ID_CHARACTERS: usize = 8;

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut text = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        text.push(DIGITS[usize::from(byte >> 4)] as char);
        text.push(DIGITS[usize::from(byte & 0x0f)] as char);
    }
    text
}

/// What a wrapper mint says about itself. Everything is derived from the authenticated position
/// definition; the caller supplies none of it.
pub fn wrapper_metadata(
    position: &PositionDefinition,
    wrapper: &Pubkey,
    mint: &Pubkey,
) -> TokenMetadata {
    let position_id = hex(&position.position_id);
    TokenMetadata {
        update_authority: OptionalNonZeroPubkey(*wrapper),
        mint: *mint,
        name: [
            WRAPPER_METADATA_NAME_PREFIX,
            &position_id[..NAME_ID_CHARACTERS],
        ]
        .concat(),
        symbol: WRAPPER_METADATA_SYMBOL.to_string(),
        uri: String::new(),
        additional_metadata: vec![
            (WRAPPER_METADATA_POSITION_ID.to_string(), position_id),
            (
                WRAPPER_METADATA_COLLECTION_ID.to_string(),
                hex(&position.collection_id),
            ),
            (
                WRAPPER_METADATA_COLLATERAL_MINT.to_string(),
                position.collateral_mint.to_string(),
            ),
        ],
    }
}

/// Stores the wrapper's metadata in its freshly created mint. The wrapper config is both mint
/// and update authority, and no instruction signs for it again, so the metadata never changes.
pub fn write_wrapper_metadata<'info>(
    position: &PositionDefinition,
    wrapper: &Account<'info, WrapperConfig>,
    mint: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
) -> CcTokenResult {
    let metadata = wrapper_metadata(position, &wrapper.key(), mint.key);

    // Token-2022 grows the mint to hold the metadata but does not pay for the extra space.
    let space = mint
        .data_len()
        .checked_add(metadata.tlv_size_of()?)
        .ok_or(CcTokenError::ArithmeticOverflow)?;
    let shortfall = Rent::get()?
        .minimum_balance(space)
        .saturating_sub(mint.lamports());
    if shortfall > 0 {
        system_program::transfer(
            CpiContext::new(
                system_program.key(),
                system_program::Transfer {
                    from: payer.clone(),
                    to: mint.clone(),
                },
            ),
            shortfall,
        )?;
    }

    let seeds = wrapper.signer_seeds();
    let signer = [seeds.as_slice()];
    let TokenMetadata {
        name,
        symbol,
        uri,
        additional_metadata,
        ..
    } = metadata;
    token_metadata_initialize(
        CpiContext::new_with_signer(
            token_program.key(),
            TokenMetadataInitialize {
                program_id: token_program.clone(),
                metadata: mint.clone(),
                update_authority: wrapper.to_account_info(),
                mint_authority: wrapper.to_account_info(),
                mint: mint.clone(),
            },
            &signer,
        ),
        name,
        symbol,
        uri,
    )?;
    for (key, value) in additional_metadata {
        token_metadata_update_field(
            CpiContext::new_with_signer(
                token_program.key(),
                TokenMetadataUpdateField {
                    program_id: token_program.clone(),
                    metadata: mint.clone(),
                    update_authority: wrapper.to_account_info(),
                },
                &signer,
            ),
            Field::Key(key),
            value,
        )?;
    }
    Ok(())
}
