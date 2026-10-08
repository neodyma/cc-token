use anchor_lang::prelude::*;

use crate::{
    constants::{COLLATERAL_SEED, COLLECTION_SEED, POSITION_SEED, STATE_VERSION},
    events::PositionRegistered,
    identity::derive_position_id,
    prelude::*,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct RegisterPositionArgs {
    pub position_id: [u8; 32],
    pub collateral_mint: Pubkey,
    pub collection_id: [u8; 32],
}

#[derive(Accounts)]
#[instruction(args: RegisterPositionArgs)]
pub struct RegisterPosition<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [COLLATERAL_SEED, args.collateral_mint.as_ref()],
        bump = collateral_config.bump
    )]
    pub collateral_config: Account<'info, CollateralConfig>,
    #[account(
        seeds = [COLLECTION_SEED, args.collection_id.as_ref()],
        bump = collection.bump
    )]
    pub collection: Account<'info, CollectionDefinition>,
    #[account(
        init_if_needed,
        payer = payer,
        space = PositionDefinition::SPACE,
        seeds = [POSITION_SEED, args.position_id.as_ref()],
        bump
    )]
    pub position: Account<'info, PositionDefinition>,
    pub system_program: Program<'info, System>,
}

pub fn register_position(
    ctx: Context<RegisterPosition>,
    args: RegisterPositionArgs,
) -> CcTokenResult {
    require!(
        ctx.accounts.collateral_config.version == STATE_VERSION
            && ctx.accounts.collateral_config.mint == args.collateral_mint,
        CcTokenError::CollateralMismatch
    );
    require!(
        ctx.accounts.collection.version == STATE_VERSION
            && ctx.accounts.collection.collection_id == args.collection_id,
        CcTokenError::CollectionMismatch
    );

    let position_id = derive_position_id(&args.collateral_mint, args.collection_id)?;
    require!(
        position_id == args.position_id,
        CcTokenError::InvalidPositionId
    );

    let registered = PositionDefinition {
        version: STATE_VERSION,
        position_id,
        collateral_mint: args.collateral_mint,
        collection_id: args.collection_id,
        bump: ctx.bumps.position,
    };
    let position = &mut ctx.accounts.position;
    if position.version == 0 {
        emit!(PositionRegistered {
            position_id,
            collateral_mint: args.collateral_mint,
            collection_id: args.collection_id,
        });
        position.set_inner(registered);
        return Ok(());
    }

    require!(
        position.version == registered.version
            && position.position_id == registered.position_id
            && position.collateral_mint == registered.collateral_mint
            && position.collection_id == registered.collection_id
            && position.bump == registered.bump,
        CcTokenError::PositionMismatch
    );
    Ok(())
}
