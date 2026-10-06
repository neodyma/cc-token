use anchor_lang::prelude::*;

use crate::prelude::*;

#[derive(Accounts)]
pub struct RegisterPosition {}

pub fn register_position(_ctx: Context<RegisterPosition>) -> CcTokenResult {
    err!(CcTokenError::InstructionNotImplemented)
}
