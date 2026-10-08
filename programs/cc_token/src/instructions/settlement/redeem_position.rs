use anchor_lang::prelude::*;

use crate::{
    constants::{
        BALANCE_SEED, COLLECTION_SEED, CONDITION_SEED, POSITION_SEED, ROOT_COLLECTION_ID,
        STATE_VERSION,
    },
    events::PositionRedeemed,
    identity::derive_position_id,
    instructions::{
        positions::{validate_balance, validate_position},
        settlement::redemption::{validate_redemption, RedeemPositionArgs},
    },
    prelude::*,
};

#[derive(Accounts)]
#[instruction(args: RedeemPositionArgs)]
pub struct RedeemPosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [CONDITION_SEED, args.condition_id.as_ref()],
        bump = condition.bump
    )]
    pub condition: Account<'info, Condition>,
    #[account(
        seeds = [COLLECTION_SEED, parent_collection.collection_id.as_ref()],
        bump = parent_collection.bump
    )]
    pub parent_collection: Account<'info, CollectionDefinition>,
    #[account(
        seeds = [POSITION_SEED, source_position.position_id.as_ref()],
        bump = source_position.bump
    )]
    pub source_position: Account<'info, PositionDefinition>,
    #[account(
        mut,
        seeds = [BALANCE_SEED, owner.key().as_ref(), source_position.position_id.as_ref()],
        bump = source_balance.bump
    )]
    pub source_balance: Account<'info, PositionBalance>,
    #[account(
        seeds = [POSITION_SEED, destination_position.position_id.as_ref()],
        bump = destination_position.bump
    )]
    pub destination_position: Account<'info, PositionDefinition>,
    #[account(
        init_if_needed,
        payer = owner,
        space = PositionBalance::SPACE,
        seeds = [BALANCE_SEED, owner.key().as_ref(), destination_position.position_id.as_ref()],
        bump
    )]
    pub destination_balance: Account<'info, PositionBalance>,
    pub system_program: Program<'info, System>,
}

pub fn redeem_position(ctx: Context<RedeemPosition>, args: RedeemPositionArgs) -> CcTokenResult {
    require!(
        ctx.accounts.parent_collection.version == STATE_VERSION
            && ctx.accounts.parent_collection.collection_id != ROOT_COLLECTION_ID,
        CcTokenError::ParentCollectionMismatch
    );
    let redemption = validate_redemption(
        &ctx.accounts.condition,
        ctx.accounts.source_position.key(),
        &ctx.accounts.source_position,
        ctx.accounts.source_balance.key(),
        &ctx.accounts.source_balance,
        ctx.accounts.owner.key(),
        ctx.accounts.parent_collection.collection_id,
        &args,
    )?;

    let collateral_mint = ctx.accounts.source_position.collateral_mint;
    let destination_position_id = derive_position_id(
        &collateral_mint,
        ctx.accounts.parent_collection.collection_id,
    )?;
    validate_position(
        &ctx.accounts.destination_position.key(),
        &ctx.accounts.destination_position,
        collateral_mint,
        ctx.accounts.parent_collection.collection_id,
        destination_position_id,
    )?;

    let destination = PositionBalance {
        version: STATE_VERSION,
        owner: ctx.accounts.owner.key(),
        position_id: destination_position_id,
        amount: ctx.accounts.destination_balance.amount,
        bump: ctx.bumps.destination_balance,
    };
    if ctx.accounts.destination_balance.version == 0 {
        ctx.accounts.destination_balance.set_inner(destination);
    } else {
        validate_balance(
            &ctx.accounts.destination_balance.key(),
            &ctx.accounts.destination_balance,
            ctx.accounts.owner.key(),
            destination_position_id,
        )?;
    }

    let destination_amount = ctx
        .accounts
        .destination_balance
        .amount
        .checked_add(redemption.payout)
        .ok_or_else(|| error!(CcTokenError::ArithmeticOverflow))?;
    ctx.accounts.source_balance.amount = redemption.source_amount;
    ctx.accounts.destination_balance.amount = destination_amount;

    emit!(PositionRedeemed {
        owner: ctx.accounts.owner.key(),
        collateral_mint,
        source_position_id: ctx.accounts.source_position.position_id,
        destination_position_id,
        condition_id: args.condition_id,
        amount: args.amount,
        payout: redemption.payout,
    });
    Ok(())
}
