use anchor_lang::prelude::*;

use crate::prelude::*;

#[derive(Accounts)]
pub struct RegisterCollection {}

pub fn register_collection(_ctx: Context<RegisterCollection>) -> CcTokenResult {
    err!(CcTokenError::InstructionNotImplemented)
}
