use anchor_lang::prelude::*;

use crate::constants::VAULT_SEED;

#[account]
#[derive(InitSpace)]
pub struct CollateralConfig {
    pub version: u8,
    pub policy_version: u8,
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub decimals: u8,
    pub vault: Pubkey,
    pub bump: u8,
    pub vault_authority_bump: u8,
}

impl CollateralConfig {
    pub const SPACE: usize = Self::DISCRIMINATOR.len() + Self::INIT_SPACE;

    pub fn vault_authority_signer_seeds(&self) -> [&[u8]; 3] {
        [
            VAULT_SEED,
            self.mint.as_ref(),
            core::slice::from_ref(&self.vault_authority_bump),
        ]
    }
}
