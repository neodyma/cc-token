use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{burn_checked, BurnChecked, Token2022},
    token_interface::{Mint, TokenAccount},
};

use crate::{
    constants::{BALANCE_SEED, POSITION_SEED, STATE_VERSION, WRAPPER_MINT_SEED, WRAPPER_SEED},
    events::{PositionBalanceInitialized, PositionUnwrapped},
    instructions::wrapping::wrapper::validate_wrapper,
    prelude::*,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct UnwrapPositionArgs {
    pub amount: u64,
}

#[derive(Accounts)]
pub struct UnwrapPosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [POSITION_SEED, position.position_id.as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, PositionDefinition>,
    #[account(
        init_if_needed,
        payer = owner,
        space = PositionBalance::SPACE,
        seeds = [BALANCE_SEED, owner.key().as_ref(), position.position_id.as_ref()],
        bump
    )]
    pub balance: Account<'info, PositionBalance>,
    #[account(
        seeds = [WRAPPER_SEED, position.position_id.as_ref()],
        bump = wrapper.bump
    )]
    pub wrapper: Account<'info, WrapperConfig>,
    #[account(
        mut,
        mint::authority = wrapper,
        mint::token_program = token_program,
        seeds = [WRAPPER_MINT_SEED, position.position_id.as_ref()],
        bump = wrapper.mint_bump
    )]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = owner,
        token::token_program = token_program
    )]
    pub source: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn unwrap_position(ctx: Context<UnwrapPosition>, args: UnwrapPositionArgs) -> CcTokenResult {
    require!(args.amount > 0, CcTokenError::ZeroAmount);
    validate_wrapper(
        &ctx.accounts.position.key(),
        &ctx.accounts.position,
        &ctx.accounts.wrapper.key(),
        &ctx.accounts.wrapper,
        &ctx.accounts.mint,
    )?;

    let initialized_balance = PositionBalance {
        version: STATE_VERSION,
        owner: ctx.accounts.owner.key(),
        position_id: ctx.accounts.position.position_id,
        amount: 0,
        bump: ctx.bumps.balance,
    };
    let balance = &mut ctx.accounts.balance;
    if balance.version == 0 {
        balance.set_inner(initialized_balance);
        emit!(PositionBalanceInitialized {
            owner: balance.owner,
            position_id: balance.position_id,
        });
    } else {
        require!(
            balance.version == initialized_balance.version
                && balance.owner == initialized_balance.owner
                && balance.position_id == initialized_balance.position_id
                && balance.bump == initialized_balance.bump,
            CcTokenError::PositionBalanceMismatch
        );
    }
    let balance_amount = balance
        .amount
        .checked_add(args.amount)
        .ok_or_else(|| error!(CcTokenError::ArithmeticOverflow))?;

    burn_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            BurnChecked {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.source.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        args.amount,
        ctx.accounts.wrapper.decimals,
    )?;
    balance.amount = balance_amount;

    emit!(PositionUnwrapped {
        owner: ctx.accounts.owner.key(),
        position_id: ctx.accounts.position.position_id,
        mint: ctx.accounts.mint.key(),
        amount: args.amount,
    });
    Ok(())
}
