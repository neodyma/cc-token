use anchor_lang::prelude::*;

use crate::{constants::CONDITION_ID_DOMAIN, math::MAX_OUTCOME_COUNT};

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, Eq, InitSpace, PartialEq,
)]
pub enum ConditionStatus {
    #[default]
    Unresolved,
    Resolved,
}

#[account]
#[derive(InitSpace)]
pub struct Condition {
    pub version: u8,
    pub condition_id: [u8; 32],
    pub resolver: Pubkey,
    pub question_id: [u8; 32],
    pub outcome_count: u16,
    pub status: ConditionStatus,
    #[max_len(MAX_OUTCOME_COUNT)]
    pub payout_numerators: Vec<u64>,
    pub payout_denominator: u128,
    pub bump: u8,
}

impl Condition {
    pub const MAX_SPACE: usize = Self::DISCRIMINATOR.len() + Self::INIT_SPACE;

    pub const fn space(outcome_count: u16) -> usize {
        Self::MAX_SPACE - MAX_OUTCOME_COUNT.saturating_sub(outcome_count) as usize * u64::INIT_SPACE
    }

    pub fn derive_id(resolver: &Pubkey, question_id: &[u8; 32], outcome_count: u16) -> [u8; 32] {
        solana_keccak_hasher::hashv(&[
            CONDITION_ID_DOMAIN,
            resolver.as_ref(),
            question_id,
            &outcome_count.to_le_bytes(),
        ])
        .to_bytes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn condition_id_fixture() {
        let condition_id = Condition::derive_id(&Pubkey::new_from_array([7; 32]), &[9; 32], 8);
        assert_eq!(
            condition_id,
            [
                0x0c, 0x78, 0x67, 0x30, 0x28, 0xe1, 0x0c, 0x4a, 0x29, 0xa2, 0x73, 0x40, 0x62, 0xf0,
                0xd3, 0xeb, 0x7f, 0xff, 0x32, 0x13, 0x9d, 0xf5, 0x14, 0x7f, 0x37, 0x50, 0xa2, 0x07,
                0x72, 0xb3, 0x24, 0x00,
            ]
        );
    }
}
