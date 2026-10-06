use anchor_lang::prelude::*;

use crate::prelude::*;

#[derive(Accounts)]
pub struct CloseBalance {}

pub fn close_balance(_ctx: Context<CloseBalance>) -> CcTokenResult {
    err!(CcTokenError::InstructionNotImplemented)
}
