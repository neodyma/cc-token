use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{
    constants::{COLLATERAL_SEED, CONDITION_SEED, VAULT_SEED},
    events::CollateralSplit,
    instructions::positions::root_collateral::{
        apply_balance_updates, validate_root_transition, BalanceOperation, RootCollateralArgs,
    },
    prelude::*,
};

#[derive(Accounts)]
#[instruction(args: RootCollateralArgs)]
pub struct SplitFromCollateral<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = owner,
        token::token_program = token_program
    )]
    pub owner_source: InterfaceAccount<'info, TokenAccount>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        seeds = [COLLATERAL_SEED, mint.key().as_ref()],
        bump = collateral_config.bump
    )]
    pub collateral_config: Account<'info, CollateralConfig>,
    /// CHECK: PDA that only signs for the vault; it holds no data.
    #[account(seeds = [VAULT_SEED, mint.key().as_ref()], bump = collateral_config.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = vault_authority,
        token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        seeds = [CONDITION_SEED, args.condition_id.as_ref()],
        bump = condition.bump
    )]
    pub condition: Account<'info, Condition>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn split_from_collateral(
    ctx: Context<SplitFromCollateral>,
    args: RootCollateralArgs,
) -> CcTokenResult {
    validate_collateral(&ctx.accounts)?;
    require!(
        ctx.accounts.owner_source.amount >= args.amount,
        CcTokenError::InsufficientCollateral
    );
    let fixed_accounts = fixed_account_keys(&ctx.accounts);
    let updates = validate_root_transition(
        ctx.remaining_accounts,
        &fixed_accounts,
        ctx.accounts.owner.key(),
        ctx.accounts.mint.key(),
        &ctx.accounts.condition,
        &args,
        BalanceOperation::Credit,
    )?;

    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.owner_source.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        args.amount,
        ctx.accounts.collateral_config.decimals,
    )?;
    apply_balance_updates(updates)?;

    emit!(CollateralSplit {
        owner: ctx.accounts.owner.key(),
        collateral_mint: ctx.accounts.mint.key(),
        condition_id: args.condition_id,
        amount: args.amount,
        position_count: args.partition.len() as u16,
    });
    Ok(())
}

fn validate_collateral(accounts: &SplitFromCollateral) -> CcTokenResult {
    require!(
        accounts.collateral_config.version == crate::constants::STATE_VERSION
            && accounts.collateral_config.mint == accounts.mint.key()
            && accounts.collateral_config.token_program == accounts.token_program.key()
            && accounts.collateral_config.decimals == accounts.mint.decimals
            && accounts.collateral_config.vault == accounts.vault.key(),
        CcTokenError::CollateralMismatch
    );
    Ok(())
}

fn fixed_account_keys(accounts: &SplitFromCollateral) -> [Pubkey; 8] {
    [
        accounts.owner.key(),
        accounts.owner_source.key(),
        accounts.mint.key(),
        accounts.collateral_config.key(),
        accounts.vault_authority.key(),
        accounts.vault.key(),
        accounts.condition.key(),
        accounts.token_program.key(),
    ]
}
