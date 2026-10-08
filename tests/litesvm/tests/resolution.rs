use std::path::PathBuf;

use anchor_lang::{
    prelude::{AccountDeserialize, Pubkey, System},
    Id, InstructionData, ToAccountMetas,
};
use cc_token::{
    accounts,
    constants::{CONDITION_SEED, PAYOUT_REPORT_SEED},
    instruction,
    instructions::{
        settlement::{AppendPayoutReportArgs, ReportPayoutsArgs},
        setup::PrepareConditionArgs,
    },
    state::{Condition, ConditionStatus, PayoutReport},
    ID,
};
use litesvm::{types::TransactionMetadata, LiteSVM};
use solana_address::Address;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::{v0, v1, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

const COMPUTE_UNIT_LIMIT: u32 = 1_400_000;
const V0_PAYOUT_CHUNK_LENGTH: usize = 96;

#[derive(Clone, Copy)]
enum TransactionVersion {
    V0,
    V1,
}

struct TestContext {
    svm: LiteSVM,
    payer: Keypair,
}

impl TestContext {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program_from_file(ID, program_path()).unwrap();
        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
        Self { svm, payer }
    }

    fn send(
        &mut self,
        instruction: Instruction,
        version: TransactionVersion,
    ) -> Result<TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
        self.svm.expire_blockhash();
        let payer = self.payer.pubkey();
        let message = match version {
            TransactionVersion::V0 => VersionedMessage::V0(
                v0::Message::try_compile(
                    &payer,
                    &[instruction],
                    &[],
                    self.svm.latest_blockhash(),
                )
                .unwrap(),
            ),
            TransactionVersion::V1 => VersionedMessage::V1(
                v1::Message::try_compile_with_config(
                    &payer,
                    &[instruction],
                    self.svm.latest_blockhash(),
                    v1::TransactionConfig::empty()
                        .with_compute_unit_limit(COMPUTE_UNIT_LIMIT)
                        .with_loaded_accounts_data_size_limit(64 * 1024),
                )
                .unwrap(),
            ),
        };
        let transaction = VersionedTransaction::try_new(message, &[&self.payer]).unwrap();
        self.svm.send_transaction(transaction)
    }

    fn condition(&self, condition_id: [u8; 32]) -> Condition {
        deserialize_account(
            &self
                .svm
                .get_account(&condition_address(condition_id))
                .unwrap()
                .data,
        )
    }

    fn payout_report(&self, condition_id: [u8; 32]) -> PayoutReport {
        deserialize_account(
            &self
                .svm
                .get_account(&payout_report_address(condition_id))
                .unwrap()
                .data,
        )
    }
}

fn program_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/deploy/cc_token.so")
        .canonicalize()
        .expect("run `pnpm build` before LiteSVM tests")
}

fn condition_args(resolver: Pubkey, question_id: [u8; 32], outcome_count: u16) -> PrepareConditionArgs {
    PrepareConditionArgs {
        condition_id: Condition::derive_id(&resolver, &question_id, outcome_count),
        resolver,
        question_id,
        outcome_count,
    }
}

fn condition_address(condition_id: [u8; 32]) -> Address {
    Address::find_program_address(&[CONDITION_SEED, &condition_id], &ID).0
}

fn payout_report_address(condition_id: [u8; 32]) -> Address {
    Address::find_program_address(&[PAYOUT_REPORT_SEED, &condition_id], &ID).0
}

fn prepare_condition_instruction(payer: Address, args: PrepareConditionArgs) -> Instruction {
    Instruction {
        program_id: ID,
        accounts: accounts::PrepareCondition {
            payer,
            condition: condition_address(args.condition_id),
            system_program: System::id(),
        }
        .to_account_metas(None),
        data: instruction::PrepareCondition { args }.data(),
    }
}

fn report_payouts_instruction(
    resolver: Address,
    condition_id: [u8; 32],
    payout_numerators: Vec<u64>,
) -> Instruction {
    Instruction {
        program_id: ID,
        accounts: accounts::ReportPayouts {
            resolver,
            condition: condition_address(condition_id),
        }
        .to_account_metas(None),
        data: instruction::ReportPayouts {
            args: ReportPayoutsArgs { payout_numerators },
        }
        .data(),
    }
}

fn initialize_payout_report_instruction(payer: Address, condition_id: [u8; 32]) -> Instruction {
    Instruction {
        program_id: ID,
        accounts: accounts::InitializePayoutReport {
            payer,
            resolver: payer,
            condition: condition_address(condition_id),
            payout_report: payout_report_address(condition_id),
            system_program: System::id(),
        }
        .to_account_metas(None),
        data: instruction::InitializePayoutReport {}.data(),
    }
}

fn append_payout_report_instruction(
    resolver: Address,
    condition_id: [u8; 32],
    payout_numerators: Vec<u64>,
) -> Instruction {
    Instruction {
        program_id: ID,
        accounts: accounts::AppendPayoutReport {
            resolver,
            condition: condition_address(condition_id),
            payout_report: payout_report_address(condition_id),
        }
        .to_account_metas(None),
        data: instruction::AppendPayoutReport {
            args: AppendPayoutReportArgs { payout_numerators },
        }
        .data(),
    }
}

fn finalize_payout_report_instruction(resolver: Address, condition_id: [u8; 32]) -> Instruction {
    Instruction {
        program_id: ID,
        accounts: accounts::FinalizePayoutReport {
            resolver,
            condition: condition_address(condition_id),
            payout_report: payout_report_address(condition_id),
            rent_refund: resolver,
        }
        .to_account_metas(None),
        data: instruction::FinalizePayoutReport {}.data(),
    }
}

fn cancel_payout_report_instruction(resolver: Address, condition_id: [u8; 32]) -> Instruction {
    Instruction {
        program_id: ID,
        accounts: accounts::CancelPayoutReport {
            resolver,
            payout_report: payout_report_address(condition_id),
            rent_refund: resolver,
        }
        .to_account_metas(None),
        data: instruction::CancelPayoutReport {}.data(),
    }
}

fn deserialize_account<T: AccountDeserialize>(data: &[u8]) -> T {
    T::try_deserialize(&mut data.as_ref()).unwrap()
}

fn assert_within_transaction_limit(metadata: &TransactionMetadata) {
    assert!(metadata.compute_units_consumed <= u64::from(COMPUTE_UNIT_LIMIT));
}

#[test]
fn direct_reports_support_fractional_and_maximum_width_payouts() {
    let mut context = TestContext::new();
    let payer = context.payer.pubkey();
    let fractional = condition_args(payer, [41; 32], 4);
    context
        .send(
            prepare_condition_instruction(payer, fractional.clone()),
            TransactionVersion::V0,
        )
        .unwrap();
    let fractional_meta = context
        .send(
            report_payouts_instruction(payer, fractional.condition_id, vec![0, 1, 2, 5]),
            TransactionVersion::V0,
        )
        .unwrap();
    let fractional_condition = context.condition(fractional.condition_id);
    assert_eq!(fractional_condition.status, ConditionStatus::Resolved);
    assert_eq!(fractional_condition.payout_numerators, vec![0, 1, 2, 5]);
    assert_eq!(fractional_condition.payout_denominator, 8);

    let maximum = condition_args(payer, [42; 32], 256);
    context
        .send(
            prepare_condition_instruction(payer, maximum.clone()),
            TransactionVersion::V0,
        )
        .unwrap();
    let maximum_meta = context
        .send(
            report_payouts_instruction(payer, maximum.condition_id, vec![u64::MAX; 256]),
            TransactionVersion::V1,
        )
        .unwrap();
    let maximum_condition = context.condition(maximum.condition_id);
    assert_eq!(maximum_condition.status, ConditionStatus::Resolved);
    assert_eq!(
        maximum_condition.payout_denominator,
        u128::from(u64::MAX) * 256
    );

    assert_within_transaction_limit(&fractional_meta);
    assert_within_transaction_limit(&maximum_meta);
    println!(
        "report_payouts fractional_cu={} maximum_256_cu={}",
        fractional_meta.compute_units_consumed, maximum_meta.compute_units_consumed
    );
}

#[test]
fn staged_report_resolves_all_256_outcomes_through_v0() {
    let mut context = TestContext::new();
    let payer = context.payer.pubkey();
    let args = condition_args(payer, [51; 32], 256);
    context
        .send(
            prepare_condition_instruction(payer, args.clone()),
            TransactionVersion::V0,
        )
        .unwrap();
    let initialize_meta = context
        .send(
            initialize_payout_report_instruction(payer, args.condition_id),
            TransactionVersion::V0,
        )
        .unwrap();

    let mut payout_numerators = vec![0; 256];
    payout_numerators[255] = 1;
    let first_append = context
        .send(
            append_payout_report_instruction(
                payer,
                args.condition_id,
                payout_numerators[..V0_PAYOUT_CHUNK_LENGTH].to_vec(),
            ),
            TransactionVersion::V0,
        )
        .unwrap();
    assert!(context
        .send(
            finalize_payout_report_instruction(payer, args.condition_id),
            TransactionVersion::V0,
        )
        .is_err());
    assert_eq!(
        context.payout_report(args.condition_id).payout_numerators.len(),
        V0_PAYOUT_CHUNK_LENGTH
    );
    assert_eq!(
        context.condition(args.condition_id).status,
        ConditionStatus::Unresolved
    );

    let mut last_append = None;
    for chunk in payout_numerators[V0_PAYOUT_CHUNK_LENGTH..].chunks(V0_PAYOUT_CHUNK_LENGTH) {
        last_append = Some(
            context
                .send(
                    append_payout_report_instruction(payer, args.condition_id, chunk.to_vec()),
                    TransactionVersion::V0,
                )
                .unwrap(),
        );
    }
    let finalize_meta = context
        .send(
            finalize_payout_report_instruction(payer, args.condition_id),
            TransactionVersion::V0,
        )
        .unwrap();

    let condition = context.condition(args.condition_id);
    assert_eq!(condition.status, ConditionStatus::Resolved);
    assert_eq!(condition.payout_numerators, payout_numerators);
    assert_eq!(condition.payout_denominator, 1);
    assert!(context
        .svm
        .get_account(&payout_report_address(args.condition_id))
        .is_none());

    for metadata in [
        &initialize_meta,
        &first_append,
        last_append.as_ref().unwrap(),
        &finalize_meta,
    ] {
        assert_within_transaction_limit(metadata);
    }
    println!(
        "staged_report_256 initialize_cu={} append_96_cu={} append_64_cu={} finalize_cu={}",
        initialize_meta.compute_units_consumed,
        first_append.compute_units_consumed,
        last_append.unwrap().compute_units_consumed,
        finalize_meta.compute_units_consumed
    );
}

#[test]
fn invalid_reports_leave_condition_and_staging_state_unchanged() {
    let mut context = TestContext::new();
    let payer = context.payer.pubkey();
    let unauthorized = condition_args(Pubkey::new_unique(), [61; 32], 2);
    context
        .send(
            prepare_condition_instruction(payer, unauthorized.clone()),
            TransactionVersion::V0,
        )
        .unwrap();
    assert!(context
        .send(
            report_payouts_instruction(payer, unauthorized.condition_id, vec![1, 0]),
            TransactionVersion::V0,
        )
        .is_err());
    assert_eq!(
        context.condition(unauthorized.condition_id).status,
        ConditionStatus::Unresolved
    );

    let args = condition_args(payer, [62; 32], 2);
    context
        .send(
            prepare_condition_instruction(payer, args.clone()),
            TransactionVersion::V0,
        )
        .unwrap();
    for payout_numerators in [vec![1], vec![0, 0]] {
        assert!(context
            .send(
                report_payouts_instruction(payer, args.condition_id, payout_numerators),
                TransactionVersion::V0,
            )
            .is_err());
    }
    assert_eq!(
        context.condition(args.condition_id).status,
        ConditionStatus::Unresolved
    );

    context
        .send(
            initialize_payout_report_instruction(payer, args.condition_id),
            TransactionVersion::V0,
        )
        .unwrap();
    for payout_numerators in [vec![], vec![1, 1, 1]] {
        assert!(context
            .send(
                append_payout_report_instruction(payer, args.condition_id, payout_numerators),
                TransactionVersion::V0,
            )
            .is_err());
    }
    let report = context.payout_report(args.condition_id);
    assert!(report.payout_numerators.is_empty());
    assert_eq!(report.payout_denominator, 0);

    context
        .send(
            cancel_payout_report_instruction(payer, args.condition_id),
            TransactionVersion::V0,
        )
        .unwrap();
    assert!(context
        .svm
        .get_account(&payout_report_address(args.condition_id))
        .is_none());
    assert_eq!(
        context.condition(args.condition_id).status,
        ConditionStatus::Unresolved
    );
}

#[test]
fn finalized_condition_rejects_every_later_report() {
    let mut context = TestContext::new();
    let payer = context.payer.pubkey();
    let args = condition_args(payer, [71; 32], 2);
    context
        .send(
            prepare_condition_instruction(payer, args.clone()),
            TransactionVersion::V0,
        )
        .unwrap();
    context
        .send(
            report_payouts_instruction(payer, args.condition_id, vec![1, 3]),
            TransactionVersion::V0,
        )
        .unwrap();

    assert!(context
        .send(
            report_payouts_instruction(payer, args.condition_id, vec![2, 2]),
            TransactionVersion::V0,
        )
        .is_err());
    let condition = context.condition(args.condition_id);
    assert_eq!(condition.payout_numerators, vec![1, 3]);
    assert_eq!(condition.payout_denominator, 4);
}
