use anchor_lang::prelude::*;

use crate::prelude::*;

#[derive(Accounts)]
pub struct InitializeBalance {}

pub fn initialize_balance(_ctx: Context<InitializeBalance>) -> CcTokenResult {
    err!(CcTokenError::InstructionNotImplemented)
}
