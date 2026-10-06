use anchor_lang::prelude::*;

use crate::prelude::*;

#[derive(Accounts)]
pub struct RegisterCollateral {}

pub fn register_collateral(_ctx: Context<RegisterCollateral>) -> CcTokenResult {
    err!(CcTokenError::InstructionNotImplemented)
}
