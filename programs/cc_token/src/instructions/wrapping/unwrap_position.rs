use anchor_lang::prelude::*;

use crate::prelude::*;

#[derive(Accounts)]
pub struct UnwrapPosition {}

pub fn unwrap_position(_ctx: Context<UnwrapPosition>) -> CcTokenResult {
    err!(CcTokenError::InstructionNotImplemented)
}
