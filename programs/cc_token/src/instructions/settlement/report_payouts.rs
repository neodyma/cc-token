use anchor_lang::prelude::*;

use crate::prelude::*;

#[derive(Accounts)]
pub struct ReportPayouts {}

pub fn report_payouts(_ctx: Context<ReportPayouts>) -> CcTokenResult {
    err!(CcTokenError::InstructionNotImplemented)
}
