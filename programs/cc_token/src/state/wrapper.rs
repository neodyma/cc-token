use anchor_lang::prelude::*;

use crate::constants::WRAPPER_SEED;

#[account]
#[derive(InitSpace)]
pub struct WrapperConfig {
    pub version: u8,
    pub position_id: [u8; 32],
    pub mint: Pubkey,
    pub decimals: u8,
    pub bump: u8,
    pub mint_bump: u8,
}

impl WrapperConfig {
    pub const SPACE: usize = Self::DISCRIMINATOR.len() + Self::INIT_SPACE;

    pub fn signer_seeds(&self) -> [&[u8]; 3] {
        [
            WRAPPER_SEED,
            self.position_id.as_ref(),
            core::slice::from_ref(&self.bump),
        ]
    }
}
