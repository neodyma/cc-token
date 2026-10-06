use anchor_lang::prelude::*;

use crate::math::IndexSet;

#[account]
#[derive(InitSpace)]
pub struct CollectionDefinition {
    pub version: u8,
    pub collection_id: [u8; 32],
    pub parent_collection_id: [u8; 32],
    pub condition_id: [u8; 32],
    pub index_set: IndexSet,
    pub bump: u8,
}

impl CollectionDefinition {
    pub const SPACE: usize = Self::DISCRIMINATOR.len() + Self::INIT_SPACE;
}
