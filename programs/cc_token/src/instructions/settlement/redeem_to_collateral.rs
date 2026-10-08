use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{
    constants::{
        BALANCE_SEED, COLLATERAL_SEED, CONDITION_SEED, POSITION_SEED, ROOT_COLLECTION_ID,
        STATE_VERSION, VAULT_SEED,
    },
    events::CollateralRedeemed,
    instructions::settlement::redemption::{validate_redemption, RedeemPositionArgs},
    prelude::*,
};

#[derive(Accounts)]
#[instruction(args: RedeemPositionArgs)]
pub struct RedeemToCollateral<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = owner,
        token::token_program = token_program
    )]
    pub owner_destination: InterfaceAccount<'info, TokenAccount>,
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
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn redeem_to_collateral(
    ctx: Context<RedeemToCollateral>,
    args: RedeemPositionArgs,
) -> CcTokenResult {
    validate_collateral(&ctx.accounts)?;
    let redemption = validate_redemption(
        &ctx.accounts.condition,
        ctx.accounts.source_position.key(),
        &ctx.accounts.source_position,
        ctx.accounts.source_balance.key(),
        &ctx.accounts.source_balance,
        ctx.accounts.owner.key(),
        ROOT_COLLECTION_ID,
        &args,
    )?;
    require!(
        ctx.accounts.vault.amount >= redemption.payout,
        CcTokenError::InsufficientCollateral
    );

    if redemption.payout > 0 {
        let signer_seeds = ctx
            .accounts
            .collateral_config
            .vault_authority_signer_seeds();
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.owner_destination.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                &[&signer_seeds],
            ),
            redemption.payout,
            ctx.accounts.collateral_config.decimals,
        )?;
    }
    ctx.accounts.source_balance.amount = redemption.source_amount;

    emit!(CollateralRedeemed {
        owner: ctx.accounts.owner.key(),
        collateral_mint: ctx.accounts.mint.key(),
        source_position_id: ctx.accounts.source_position.position_id,
        condition_id: args.condition_id,
        amount: args.amount,
        payout: redemption.payout,
    });
    Ok(())
}

fn validate_collateral(accounts: &RedeemToCollateral) -> CcTokenResult {
    require!(
        accounts.collateral_config.version == STATE_VERSION
            && accounts.collateral_config.mint == accounts.mint.key()
            && accounts.collateral_config.token_program == accounts.token_program.key()
            && accounts.collateral_config.decimals == accounts.mint.decimals
            && accounts.collateral_config.vault == accounts.vault.key()
            && accounts.source_position.collateral_mint == accounts.mint.key(),
        CcTokenError::CollateralMismatch
    );
    Ok(())
}
