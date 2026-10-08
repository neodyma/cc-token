use anchor_lang::prelude::*;

use crate::{constants::PAYOUT_REPORT_SEED, prelude::*};

#[derive(Accounts)]
pub struct CancelPayoutReport<'info> {
    pub resolver: Signer<'info>,
    #[account(
        mut,
        close = rent_refund,
        seeds = [PAYOUT_REPORT_SEED, payout_report.condition_id.as_ref()],
        bump = payout_report.bump,
        has_one = resolver @ CcTokenError::UnauthorizedResolver,
        constraint = payout_report.rent_payer == rent_refund.key()
            @ CcTokenError::PayoutReportMismatch
    )]
    pub payout_report: Account<'info, PayoutReport>,
    #[account(mut)]
    pub rent_refund: SystemAccount<'info>,
}

pub fn cancel_payout_report(_ctx: Context<CancelPayoutReport>) -> CcTokenResult {
    Ok(())
}
