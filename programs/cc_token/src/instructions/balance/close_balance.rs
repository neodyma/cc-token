use anchor_lang::prelude::*;

use crate::{
    constants::{BALANCE_SEED, POSITION_SEED, STATE_VERSION},
    events::PositionBalanceClosed,
    prelude::*,
};

#[derive(Accounts)]
pub struct CloseBalance<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [POSITION_SEED, position.position_id.as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, PositionDefinition>,
    #[account(
        mut,
        close = owner,
        seeds = [BALANCE_SEED, owner.key().as_ref(), position.position_id.as_ref()],
        bump = balance.bump,
        constraint = balance.owner == owner.key() @ CcTokenError::PositionBalanceMismatch,
        constraint = balance.position_id == position.position_id @ CcTokenError::PositionBalanceMismatch
    )]
    pub balance: Account<'info, PositionBalance>,
}

pub fn close_balance(ctx: Context<CloseBalance>) -> CcTokenResult {
    require!(
        ctx.accounts.position.version == STATE_VERSION,
        CcTokenError::PositionMismatch
    );
    require!(
        ctx.accounts.balance.version == STATE_VERSION,
        CcTokenError::PositionBalanceMismatch
    );
    require!(
        ctx.accounts.balance.amount == 0,
        CcTokenError::NonzeroPositionBalance
    );
    emit!(PositionBalanceClosed {
        owner: ctx.accounts.owner.key(),
        position_id: ctx.accounts.position.position_id,
    });
    Ok(())
}
