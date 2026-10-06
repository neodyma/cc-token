pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod prelude;
pub mod state;

use anchor_lang::prelude::*;
use instructions::*;
use prelude::*;

declare_id!("JD3GWECaXcJGUWnYdcGvKciNyFbsiPH7nw29AsZKEjNW");

#[program]
pub mod cc_token {
    use super::*;

    pub fn register_collateral(ctx: Context<RegisterCollateral>) -> CcTokenResult {
        setup::register_collateral(ctx)
    }

    pub fn prepare_condition(ctx: Context<PrepareCondition>) -> CcTokenResult {
        setup::prepare_condition(ctx)
    }

    pub fn register_collection(ctx: Context<RegisterCollection>) -> CcTokenResult {
        definitions::register_collection(ctx)
    }

    pub fn register_position(ctx: Context<RegisterPosition>) -> CcTokenResult {
        definitions::register_position(ctx)
    }

    pub fn initialize_balance(ctx: Context<InitializeBalance>) -> CcTokenResult {
        balance::initialize_balance(ctx)
    }

    pub fn close_balance(ctx: Context<CloseBalance>) -> CcTokenResult {
        balance::close_balance(ctx)
    }

    pub fn split_from_collateral(ctx: Context<SplitFromCollateral>) -> CcTokenResult {
        positions::split_from_collateral(ctx)
    }

    pub fn merge_to_collateral(ctx: Context<MergeToCollateral>) -> CcTokenResult {
        positions::merge_to_collateral(ctx)
    }

    pub fn split_position(ctx: Context<SplitPosition>) -> CcTokenResult {
        positions::split_position(ctx)
    }

    pub fn merge_positions(ctx: Context<MergePositions>) -> CcTokenResult {
        positions::merge_positions(ctx)
    }

    pub fn transfer_position(ctx: Context<TransferPosition>) -> CcTokenResult {
        positions::transfer_position(ctx)
    }

    pub fn batch_transfer_positions(ctx: Context<BatchTransferPositions>) -> CcTokenResult {
        positions::batch_transfer_positions(ctx)
    }

    pub fn report_payouts(ctx: Context<ReportPayouts>) -> CcTokenResult {
        settlement::report_payouts(ctx)
    }

    pub fn redeem_position(ctx: Context<RedeemPosition>) -> CcTokenResult {
        settlement::redeem_position(ctx)
    }

    pub fn initialize_wrapper(ctx: Context<InitializeWrapper>) -> CcTokenResult {
        wrapping::initialize_wrapper(ctx)
    }

    pub fn wrap_position(ctx: Context<WrapPosition>) -> CcTokenResult {
        wrapping::wrap_position(ctx)
    }

    pub fn unwrap_position(ctx: Context<UnwrapPosition>) -> CcTokenResult {
        wrapping::unwrap_position(ctx)
    }

    pub fn compress_position(ctx: Context<CompressPosition>) -> CcTokenResult {
        compression::compress_position(ctx)
    }

    pub fn decompress_position(ctx: Context<DecompressPosition>) -> CcTokenResult {
        compression::decompress_position(ctx)
    }
}
