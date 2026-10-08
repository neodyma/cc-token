use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{mint_to_checked, MintToChecked, Token2022},
    token_interface::{Mint, TokenAccount},
};

use crate::{
    constants::{BALANCE_SEED, POSITION_SEED, WRAPPER_MINT_SEED, WRAPPER_SEED},
    events::PositionWrapped,
    instructions::{positions::validate_balance, wrapping::wrapper::validate_wrapper},
    prelude::*,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct WrapPositionArgs {
    pub amount: u64,
}

#[derive(Accounts)]
pub struct WrapPosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [POSITION_SEED, position.position_id.as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, PositionDefinition>,
    #[account(
        mut,
        seeds = [BALANCE_SEED, owner.key().as_ref(), position.position_id.as_ref()],
        bump = balance.bump
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
    pub destination: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Program<'info, Token2022>,
}

pub fn wrap_position(ctx: Context<WrapPosition>, args: WrapPositionArgs) -> CcTokenResult {
    require!(args.amount > 0, CcTokenError::ZeroAmount);
    validate_wrapper(
        &ctx.accounts.position.key(),
        &ctx.accounts.position,
        &ctx.accounts.wrapper.key(),
        &ctx.accounts.wrapper,
        &ctx.accounts.mint,
    )?;
    validate_balance(
        &ctx.accounts.balance.key(),
        &ctx.accounts.balance,
        ctx.accounts.owner.key(),
        ctx.accounts.position.position_id,
    )?;

    let balance_amount = ctx
        .accounts
        .balance
        .amount
        .checked_sub(args.amount)
        .ok_or_else(|| error!(CcTokenError::InsufficientPositionBalance))?;
    let signer_seeds = ctx.accounts.wrapper.signer_seeds();
    mint_to_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintToChecked {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.wrapper.to_account_info(),
            },
            &[&signer_seeds],
        ),
        args.amount,
        ctx.accounts.wrapper.decimals,
    )?;
    ctx.accounts.balance.amount = balance_amount;

    emit!(PositionWrapped {
        owner: ctx.accounts.owner.key(),
        position_id: ctx.accounts.position.position_id,
        mint: ctx.accounts.mint.key(),
        amount: args.amount,
    });
    Ok(())
}
