use anchor_lang::prelude::*;

use crate::prelude::*;

#[derive(Accounts)]
pub struct PrepareCondition {}

pub fn prepare_condition(_ctx: Context<PrepareCondition>) -> CcTokenResult {
    err!(CcTokenError::InstructionNotImplemented)
}
