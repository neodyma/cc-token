pub mod constants;
pub mod errors;
pub mod events;
pub mod identity;
pub mod instructions;
pub mod math;
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

    pub fn prepare_condition(
        ctx: Context<PrepareCondition>,
        args: PrepareConditionArgs,
    ) -> CcTokenResult {
        setup::prepare_condition(ctx, args)
    }

    pub fn register_collection(
        ctx: Context<RegisterCollection>,
        args: RegisterCollectionArgs,
    ) -> CcTokenResult {
        definitions::register_collection(ctx, args)
    }

    pub fn register_position(
        ctx: Context<RegisterPosition>,
        args: RegisterPositionArgs,
    ) -> CcTokenResult {
        definitions::register_position(ctx, args)
    }

    pub fn initialize_balance(ctx: Context<InitializeBalance>) -> CcTokenResult {
        balance::initialize_balance(ctx)
    }

    pub fn close_balance(ctx: Context<CloseBalance>) -> CcTokenResult {
        balance::close_balance(ctx)
    }

    pub fn split_from_collateral(
        ctx: Context<SplitFromCollateral>,
        args: RootCollateralArgs,
    ) -> CcTokenResult {
        positions::split_from_collateral(ctx, args)
    }

    pub fn merge_to_collateral(
        ctx: Context<MergeToCollateral>,
        args: RootCollateralArgs,
    ) -> CcTokenResult {
        positions::merge_to_collateral(ctx, args)
    }

    pub fn split_position(ctx: Context<SplitPosition>, args: NativePositionArgs) -> CcTokenResult {
        positions::split_position(ctx, args)
    }

    pub fn merge_positions(
        ctx: Context<MergePositions>,
        args: NativePositionArgs,
    ) -> CcTokenResult {
        positions::merge_positions(ctx, args)
    }

    pub fn transfer_position<'info>(
        ctx: Context<'info, TransferPosition<'info>>,
        args: TransferPositionArgs,
    ) -> CcTokenResult {
        positions::transfer_position(ctx, args)
    }

    pub fn batch_transfer_positions(ctx: Context<BatchTransferPositions>) -> CcTokenResult {
        positions::batch_transfer_positions(ctx)
    }

    pub fn report_payouts(ctx: Context<ReportPayouts>, args: ReportPayoutsArgs) -> CcTokenResult {
        settlement::report_payouts(ctx, args)
    }

    pub fn initialize_payout_report(ctx: Context<InitializePayoutReport>) -> CcTokenResult {
        settlement::initialize_payout_report(ctx)
    }

    pub fn append_payout_report(
        ctx: Context<AppendPayoutReport>,
        args: AppendPayoutReportArgs,
    ) -> CcTokenResult {
        settlement::append_payout_report(ctx, args)
    }

    pub fn finalize_payout_report(ctx: Context<FinalizePayoutReport>) -> CcTokenResult {
        settlement::finalize_payout_report(ctx)
    }

    pub fn cancel_payout_report(ctx: Context<CancelPayoutReport>) -> CcTokenResult {
        settlement::cancel_payout_report(ctx)
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
