use anchor_lang::prelude::*;

use crate::{
    constants::{CONDITION_ID_DOMAIN, STATE_VERSION},
    errors::CcTokenError,
    math::MAX_OUTCOME_COUNT,
};

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

    pub fn resolve(&mut self, payout_numerators: Vec<u64>) -> Result<u128> {
        require!(
            self.version == STATE_VERSION
                && self.condition_id
                    == Self::derive_id(&self.resolver, &self.question_id, self.outcome_count),
            CcTokenError::ConditionMismatch
        );
        require!(
            self.status == ConditionStatus::Unresolved,
            CcTokenError::ConditionAlreadyResolved
        );
        require!(
            payout_numerators.len() == usize::from(self.outcome_count),
            CcTokenError::PayoutNumeratorCountMismatch
        );

        let payout_denominator = payout_numerators.iter().try_fold(0u128, |sum, value| {
            sum.checked_add(u128::from(*value))
                .ok_or_else(|| error!(CcTokenError::ArithmeticOverflow))
        })?;
        require!(payout_denominator > 0, CcTokenError::ZeroPayoutDenominator);

        self.payout_numerators = payout_numerators;
        self.payout_denominator = payout_denominator;
        self.status = ConditionStatus::Resolved;
        Ok(payout_denominator)
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

    fn unresolved_condition(outcome_count: u16) -> Condition {
        let resolver = Pubkey::new_unique();
        let question_id = [3; 32];
        Condition {
            version: STATE_VERSION,
            condition_id: Condition::derive_id(&resolver, &question_id, outcome_count),
            resolver,
            question_id,
            outcome_count,
            status: ConditionStatus::Unresolved,
            payout_numerators: vec![0; usize::from(outcome_count)],
            payout_denominator: 0,
            bump: 1,
        }
    }

    #[test]
    fn resolution_stores_exact_fractional_payouts() {
        let mut condition = unresolved_condition(4);

        let denominator = condition.resolve(vec![0, 1, 2, 5]).unwrap();

        assert_eq!(denominator, 8);
        assert_eq!(condition.payout_numerators, vec![0, 1, 2, 5]);
        assert_eq!(condition.payout_denominator, 8);
        assert_eq!(condition.status, ConditionStatus::Resolved);
    }

    #[test]
    fn resolution_rejects_invalid_or_repeated_reports_without_mutation() {
        let mut condition = unresolved_condition(2);
        let initial_payouts = condition.payout_numerators.clone();

        assert!(condition.resolve(vec![1]).is_err());
        assert!(condition.resolve(vec![0, 0]).is_err());
        assert_eq!(condition.payout_numerators, initial_payouts);
        assert_eq!(condition.status, ConditionStatus::Unresolved);

        condition.resolve(vec![1, 3]).unwrap();
        assert!(condition.resolve(vec![2, 2]).is_err());
        assert_eq!(condition.payout_numerators, vec![1, 3]);
        assert_eq!(condition.payout_denominator, 4);
    }
}
