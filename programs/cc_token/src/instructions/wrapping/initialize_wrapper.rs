use anchor_lang::prelude::*;
use anchor_spl::{token_2022::Token2022, token_interface::Mint};

use crate::{
    constants::{COLLATERAL_SEED, POSITION_SEED, STATE_VERSION, WRAPPER_MINT_SEED, WRAPPER_SEED},
    events::WrapperInitialized,
    instructions::positions::validate_position_identity,
    prelude::*,
};

#[derive(Accounts)]
pub struct InitializeWrapper<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [POSITION_SEED, position.position_id.as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, PositionDefinition>,
    #[account(
        seeds = [COLLATERAL_SEED, position.collateral_mint.as_ref()],
        bump = collateral_config.bump
    )]
    pub collateral_config: Account<'info, CollateralConfig>,
    #[account(
        init_if_needed,
        payer = payer,
        space = WrapperConfig::SPACE,
        seeds = [WRAPPER_SEED, position.position_id.as_ref()],
        bump
    )]
    pub wrapper: Account<'info, WrapperConfig>,
    #[account(
        init_if_needed,
        payer = payer,
        mint::decimals = collateral_config.decimals,
        mint::authority = wrapper,
        mint::token_program = token_program,
        seeds = [WRAPPER_MINT_SEED, position.position_id.as_ref()],
        bump
    )]
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_wrapper(ctx: Context<InitializeWrapper>) -> CcTokenResult {
    validate_position_identity(&ctx.accounts.position.key(), &ctx.accounts.position)?;
    require!(
        ctx.accounts.collateral_config.version == STATE_VERSION
            && ctx.accounts.collateral_config.mint == ctx.accounts.position.collateral_mint
            && ctx.accounts.collateral_config.decimals == ctx.accounts.mint.decimals,
        CcTokenError::CollateralMismatch
    );

    let initialized = WrapperConfig {
        version: STATE_VERSION,
        position_id: ctx.accounts.position.position_id,
        mint: ctx.accounts.mint.key(),
        decimals: ctx.accounts.collateral_config.decimals,
        bump: ctx.bumps.wrapper,
        mint_bump: ctx.bumps.mint,
    };
    let wrapper = &mut ctx.accounts.wrapper;
    if wrapper.version == 0 {
        wrapper.set_inner(initialized);
        emit!(WrapperInitialized {
            position_id: wrapper.position_id,
            mint: wrapper.mint,
            decimals: wrapper.decimals,
        });
        return Ok(());
    }

    require!(
        wrapper.version == initialized.version
            && wrapper.position_id == initialized.position_id
            && wrapper.mint == initialized.mint
            && wrapper.decimals == initialized.decimals
            && wrapper.bump == initialized.bump
            && wrapper.mint_bump == initialized.mint_bump,
        CcTokenError::WrapperMismatch
    );
    Ok(())
}
