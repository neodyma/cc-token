use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::spl_token_2022::{
        extension::{BaseStateWithExtensions, StateWithExtensions},
        state::Mint as MintState,
    },
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    constants::{COLLATERAL_POLICY_VERSION, COLLATERAL_SEED, STATE_VERSION, VAULT_SEED},
    events::CollateralRegistered,
    prelude::*,
};

#[derive(Accounts)]
pub struct RegisterCollateral<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = payer,
        space = CollateralConfig::SPACE,
        seeds = [COLLATERAL_SEED, mint.key().as_ref()],
        bump
    )]
    pub config: Account<'info, CollateralConfig>,
    /// CHECK: PDA that only signs for the vault; it holds no data.
    #[account(seeds = [VAULT_SEED, mint.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = vault_authority,
        associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn register_collateral(ctx: Context<RegisterCollateral>) -> CcTokenResult {
    validate_mint_policy(&ctx.accounts.mint.to_account_info())?;
    let freeze_authority = if ctx.accounts.mint.freeze_authority.is_some() {
        CollateralFreezeAuthority::IssuerControlled
    } else {
        CollateralFreezeAuthority::Unfreezable
    };

    let registered = CollateralConfig {
        version: STATE_VERSION,
        policy_version: COLLATERAL_POLICY_VERSION,
        mint: ctx.accounts.mint.key(),
        token_program: ctx.accounts.token_program.key(),
        decimals: ctx.accounts.mint.decimals,
        freeze_authority,
        vault: ctx.accounts.vault.key(),
        bump: ctx.bumps.config,
        vault_authority_bump: ctx.bumps.vault_authority,
    };

    let config = &mut ctx.accounts.config;
    if config.version == 0 {
        emit!(CollateralRegistered {
            mint: registered.mint,
            token_program: registered.token_program,
            vault: registered.vault,
            decimals: registered.decimals,
            freeze_authority: registered.freeze_authority,
        });
        config.set_inner(registered);
        return Ok(());
    }

    let freeze_authority_matches = config.freeze_authority == registered.freeze_authority
        || (config.freeze_authority == CollateralFreezeAuthority::IssuerControlled
            && registered.freeze_authority == CollateralFreezeAuthority::Unfreezable);
    require!(
        config.version == registered.version
            && config.policy_version == registered.policy_version
            && config.mint == registered.mint
            && config.token_program == registered.token_program
            && config.decimals == registered.decimals
            && freeze_authority_matches
            && config.vault == registered.vault
            && config.bump == registered.bump
            && config.vault_authority_bump == registered.vault_authority_bump,
        CcTokenError::CollateralMismatch
    );

    Ok(())
}

// SPL Token mints carry no extensions; Token-2022 mints are admitted only without any.
fn validate_mint_policy(mint: &AccountInfo) -> CcTokenResult {
    let data = mint.try_borrow_data()?;
    let extensions = StateWithExtensions::<MintState>::unpack(&data)?.get_extension_types()?;
    require!(
        extensions.is_empty(),
        CcTokenError::UnsupportedCollateralExtension
    );
    Ok(())
}
