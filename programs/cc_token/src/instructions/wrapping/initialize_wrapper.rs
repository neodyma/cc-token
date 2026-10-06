use anchor_lang::prelude::*;

use crate::prelude::*;

#[derive(Accounts)]
pub struct InitializeWrapper {}

pub fn initialize_wrapper(_ctx: Context<InitializeWrapper>) -> CcTokenResult {
    err!(CcTokenError::InstructionNotImplemented)
}
