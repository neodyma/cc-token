use anchor_lang::prelude::*;

use crate::constants::COLLATERAL_SEED;

#[account]
#[derive(InitSpace)]
pub struct CollateralConfig {
    pub mint: Pubkey,
    pub bump: u8,
    pub vault_bump:u8,
}

impl CollateralConfig {
    pub fn config_signer_seeds(&self) -> [&[u8]; 3]{
        [
            COLLATERAL_SEED,
            self.mint.as_ref(),
            core::slice::from_ref(&self.bump),
        ]
    }
}