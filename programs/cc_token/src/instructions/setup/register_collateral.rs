use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::{COLLATERAL_SEED, VAULT_SEED},
    events::CollateralRegistered,
    prelude::*
};

#[derive(Accounts)]
pub struct RegisterCollateral <'info>{
    #[account(mut)]
    pub payer: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer=payer,
        space= CollateralConfig::DISCRIMINATOR.len() + CollateralConfig::INIT_SPACE,
        seeds=[COLLATERAL_SEED, mint.key().as_ref()],
        bump,
    )]
    pub config: Account<'info, CollateralConfig>,

    // ?! TA vs ATA trade off
    #[account(
        init,
        payer=payer,
        seeds=[VAULT_SEED, mint.key().as_ref()],
        bump,
        token::mint= mint,
        token::authority=config,
        token::token_program= token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info,System>
}

pub fn register_collateral(ctx: Context<RegisterCollateral>) -> CcTokenResult {

    // ?! confirm vanilla token, if 2022 -> no extensions that could break 1:1 backing

    ctx.accounts.config.set_inner(CollateralConfig { 
        mint: ctx.accounts.mint.key(), 
        bump: ctx.bumps.config, 
        vault_bump: ctx.bumps.vault
    });

    emit!(CollateralRegistered{ 
        mint: ctx.accounts.mint.key(), 
        vault: ctx.accounts.vault.key(), 
        decimals: ctx.accounts.mint.decimals
    });


    Ok(())
}
