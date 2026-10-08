use anchor_lang::prelude::*;

use crate::{
    constants::{BALANCE_SEED, POSITION_SEED, STATE_VERSION},
    events::PositionBalanceInitialized,
    prelude::*,
};

#[derive(Accounts)]
pub struct InitializeBalance<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: The owner is stored as the balance identity and need not sign initialization.
    pub owner: UncheckedAccount<'info>,
    #[account(
        seeds = [POSITION_SEED, position.position_id.as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, PositionDefinition>,
    #[account(
        init_if_needed,
        payer = payer,
        space = PositionBalance::SPACE,
        seeds = [BALANCE_SEED, owner.key().as_ref(), position.position_id.as_ref()],
        bump
    )]
    pub balance: Account<'info, PositionBalance>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_balance(ctx: Context<InitializeBalance>) -> CcTokenResult {
    require!(
        ctx.accounts.position.version == STATE_VERSION,
        CcTokenError::PositionMismatch
    );

    let initialized = PositionBalance {
        version: STATE_VERSION,
        owner: ctx.accounts.owner.key(),
        position_id: ctx.accounts.position.position_id,
        amount: 0,
        bump: ctx.bumps.balance,
    };
    let balance = &mut ctx.accounts.balance;
    if balance.version == 0 {
        emit!(PositionBalanceInitialized {
            owner: initialized.owner,
            position_id: initialized.position_id,
        });
        balance.set_inner(initialized);
        return Ok(());
    }

    require!(
        balance.version == initialized.version
            && balance.owner == initialized.owner
            && balance.position_id == initialized.position_id
            && balance.bump == initialized.bump,
        CcTokenError::PositionBalanceMismatch
    );
    Ok(())
}
