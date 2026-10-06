use anchor_lang::prelude::*;

use crate::prelude::*;

#[derive(Accounts)]
pub struct WrapPosition {}

pub fn wrap_position(_ctx: Context<WrapPosition>) -> CcTokenResult {
    err!(CcTokenError::InstructionNotImplemented)
}
