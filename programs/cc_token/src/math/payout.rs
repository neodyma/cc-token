use anchor_lang::prelude::*;
use crypto_bigint::{NonZero, U256, U64};

use crate::prelude::*;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PayoutRatio {
    pub numerator: u128,
    pub denominator: u128,
}

pub fn payout_ratio(payout_numerators: &[u64], index_set: IndexSet) -> CcTokenResult<PayoutRatio> {
    let outcome_count = u16::try_from(payout_numerators.len())
        .map_err(|_| error!(CcTokenError::InvalidOutcomeCount))?;
    index_set.validate(outcome_count)?;

    let mut numerator = 0u128;
    let mut denominator = 0u128;
    for (outcome, payout_numerator) in payout_numerators.iter().copied().enumerate() {
        denominator = denominator
            .checked_add(u128::from(payout_numerator))
            .ok_or_else(|| error!(CcTokenError::ArithmeticOverflow))?;
        if index_set.contains(outcome as u16) {
            numerator = numerator
                .checked_add(u128::from(payout_numerator))
                .ok_or_else(|| error!(CcTokenError::ArithmeticOverflow))?;
        }
    }

    require!(denominator > 0, CcTokenError::ZeroPayoutDenominator);
    Ok(PayoutRatio {
        numerator,
        denominator,
    })
}

pub fn calculate_payout(amount: u64, numerator: u128, denominator: u128) -> CcTokenResult<u64> {
    require!(denominator > 0, CcTokenError::ZeroPayoutDenominator);
    require!(
        numerator <= denominator,
        CcTokenError::InvalidPayoutFraction
    );

    let product = U256::from_u64(amount)
        .checked_mul(&U256::from_u128(numerator))
        .into_option()
        .ok_or_else(|| error!(CcTokenError::ArithmeticOverflow))?;
    let denominator = NonZero::new(U256::from_u128(denominator))
        .into_option()
        .ok_or_else(|| error!(CcTokenError::ZeroPayoutDenominator))?;
    // Payout values are public; variable-time division avoids unnecessary CU.
    let quotient = product.div_rem_vartime(&denominator).0;
    let payout = quotient
        .resize_checked::<{ U64::LIMBS }>()
        .into_option()
        .ok_or_else(|| error!(CcTokenError::ArithmeticOverflow))?;

    Ok(u64::from(payout))
}

pub fn calculate_position_payout(
    amount: u64,
    payout_numerators: &[u64],
    index_set: IndexSet,
) -> CcTokenResult<u64> {
    let ratio = payout_ratio(payout_numerators, index_set)?;
    calculate_payout(amount, ratio.numerator, ratio.denominator)
}

#[cfg(test)]
mod tests {
    use num_bigint::BigUint;

    use super::*;

    #[test]
    fn calculates_the_136_bit_product_exactly() {
        let maximum = u64::MAX;
        let numerator = u128::from(maximum) * 255;
        let denominator = numerator + 1;
        let product = BigUint::from(maximum) * BigUint::from(numerator);

        assert_eq!(product.bits(), 136);
        assert_eq!(
            calculate_payout(maximum, numerator, denominator).unwrap(),
            maximum - 1
        );
    }

    #[test]
    fn derives_selected_and_total_sums() {
        let mut payout_numerators = vec![u64::MAX; 255];
        payout_numerators.push(1);
        let index_set = IndexSet {
            words: [u64::MAX, u64::MAX, u64::MAX, u64::MAX >> 1],
        };
        let ratio = payout_ratio(&payout_numerators, index_set).unwrap();

        assert_eq!(ratio.numerator, u128::from(u64::MAX) * 255);
        assert_eq!(ratio.denominator, ratio.numerator + 1);
        assert_eq!(
            calculate_position_payout(u64::MAX, &payout_numerators, index_set).unwrap(),
            u64::MAX - 1
        );
    }

    #[test]
    fn rejects_invalid_payout_inputs() {
        assert!(calculate_payout(1, 0, 0).is_err());
        assert!(calculate_payout(1, 2, 1).is_err());
        assert!(payout_ratio(
            &[0, 0],
            IndexSet {
                words: [1, 0, 0, 0]
            }
        )
        .is_err());
        assert!(payout_ratio(
            &[1],
            IndexSet {
                words: [1, 0, 0, 0]
            }
        )
        .is_err());
    }

    #[test]
    fn agrees_with_arbitrary_precision_reference_cases() {
        let mut state = 0xd1b5_4a32_d192_ed03u64;
        for _ in 0..1_000 {
            let amount = next(&mut state);
            let denominator = (u128::from(next(&mut state)) << 64) | u128::from(next(&mut state));
            let denominator = denominator.max(1);
            let candidate = (u128::from(next(&mut state)) << 64) | u128::from(next(&mut state));
            let numerator = candidate.min(denominator);

            let actual = calculate_payout(amount, numerator, denominator).unwrap();
            let expected =
                BigUint::from(amount) * BigUint::from(numerator) / BigUint::from(denominator);
            assert_eq!(BigUint::from(actual), expected);
        }
    }

    fn next(state: &mut u64) -> u64 {
        *state = state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        *state
    }
}
