use anchor_lang::prelude::*;

use crate::{constants::CONDITION_SEED, prelude::*};

use super::resolve_condition;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct ReportPayoutsArgs {
    pub payout_numerators: Vec<u64>,
}

#[derive(Accounts)]
pub struct ReportPayouts<'info> {
    pub resolver: Signer<'info>,
    #[account(
        mut,
        seeds = [CONDITION_SEED, condition.condition_id.as_ref()],
        bump = condition.bump,
        has_one = resolver @ CcTokenError::UnauthorizedResolver
    )]
    pub condition: Account<'info, Condition>,
}

pub fn report_payouts(ctx: Context<ReportPayouts>, args: ReportPayoutsArgs) -> CcTokenResult {
    resolve_condition(&mut ctx.accounts.condition, args.payout_numerators)
}
