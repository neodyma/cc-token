use anchor_lang::prelude::*;

use crate::{
    constants::STATE_VERSION,
    errors::CcTokenError,
    math::MAX_OUTCOME_COUNT,
    state::{Condition, ConditionStatus},
};

#[account]
#[derive(InitSpace)]
pub struct PayoutReport {
    pub version: u8,
    pub condition_id: [u8; 32],
    pub resolver: Pubkey,
    pub rent_payer: Pubkey,
    pub outcome_count: u16,
    pub payout_denominator: u128,
    pub bump: u8,
    #[max_len(MAX_OUTCOME_COUNT)]
    pub payout_numerators: Vec<u64>,
}

impl PayoutReport {
    pub const MAX_SPACE: usize = Self::DISCRIMINATOR.len() + Self::INIT_SPACE;

    pub const fn space(outcome_count: u16) -> usize {
        Self::MAX_SPACE - MAX_OUTCOME_COUNT.saturating_sub(outcome_count) as usize * u64::INIT_SPACE
    }

    pub fn append(&mut self, condition: &Condition, payout_numerators: &[u64]) -> Result<()> {
        self.validate(condition)?;
        require!(
            condition.status == ConditionStatus::Unresolved,
            CcTokenError::ConditionAlreadyResolved
        );
        require!(
            !payout_numerators.is_empty(),
            CcTokenError::EmptyPayoutChunk
        );
        let new_length = self
            .payout_numerators
            .len()
            .checked_add(payout_numerators.len())
            .ok_or_else(|| error!(CcTokenError::ArithmeticOverflow))?;
        require!(
            new_length <= usize::from(self.outcome_count),
            CcTokenError::PayoutReportTooLong
        );
        let chunk_denominator = payout_numerators.iter().try_fold(0u128, |sum, value| {
            sum.checked_add(u128::from(*value))
                .ok_or_else(|| error!(CcTokenError::ArithmeticOverflow))
        })?;
        let payout_denominator = self
            .payout_denominator
            .checked_add(chunk_denominator)
            .ok_or_else(|| error!(CcTokenError::ArithmeticOverflow))?;

        self.payout_numerators.extend_from_slice(payout_numerators);
        self.payout_denominator = payout_denominator;
        Ok(())
    }

    pub fn validate_complete(&self, condition: &Condition) -> Result<()> {
        self.validate(condition)?;
        require!(
            condition.status == ConditionStatus::Unresolved,
            CcTokenError::ConditionAlreadyResolved
        );
        require!(
            self.payout_numerators.len() == usize::from(self.outcome_count),
            CcTokenError::IncompletePayoutReport
        );
        require!(
            self.payout_denominator > 0,
            CcTokenError::ZeroPayoutDenominator
        );
        Ok(())
    }

    fn validate(&self, condition: &Condition) -> Result<()> {
        require!(
            self.version == STATE_VERSION
                && self.condition_id == condition.condition_id
                && self.resolver == condition.resolver
                && self.outcome_count == condition.outcome_count,
            CcTokenError::PayoutReportMismatch
        );
        Ok(())
    }
}
