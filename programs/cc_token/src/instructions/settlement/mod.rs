mod append_payout_report;
mod cancel_payout_report;
mod finalize_payout_report;
mod initialize_payout_report;
mod redeem_position;
mod redeem_to_collateral;
mod redemption;
mod report_payouts;

pub use append_payout_report::*;
pub use cancel_payout_report::*;
pub use finalize_payout_report::*;
pub use initialize_payout_report::*;
pub use redeem_position::*;
pub use redeem_to_collateral::*;
pub use redemption::RedeemPositionArgs;
pub use report_payouts::*;

use anchor_lang::prelude::*;

use crate::{events::PayoutsReported, prelude::*};

fn resolve_condition(condition: &mut Condition, payout_numerators: Vec<u64>) -> CcTokenResult {
    let payout_denominator = condition.resolve(payout_numerators)?;
    emit!(PayoutsReported {
        condition_id: condition.condition_id,
        resolver: condition.resolver,
        outcome_count: condition.outcome_count,
        payout_denominator,
    });
    Ok(())
}
