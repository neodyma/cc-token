use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct PositionDefinition {
    pub version: u8,
    pub position_id: [u8; 32],
    pub collateral_mint: Pubkey,
    pub collection_id: [u8; 32],
    pub bump: u8,
}

impl PositionDefinition {
    pub const SPACE: usize = Self::DISCRIMINATOR.len() + Self::INIT_SPACE;
}

#[account]
#[derive(InitSpace)]
pub struct PositionBalance {
    pub version: u8,
    pub owner: Pubkey,
    pub position_id: [u8; 32],
    pub amount: u64,
    pub bump: u8,
}

impl PositionBalance {
    pub const SPACE: usize = Self::DISCRIMINATOR.len() + Self::INIT_SPACE;
}
