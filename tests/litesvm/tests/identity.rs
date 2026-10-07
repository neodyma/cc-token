use std::path::PathBuf;

use anchor_lang::{
    prelude::{AccountDeserialize, AccountSerialize, Pubkey, System},
    Id, InstructionData, ToAccountMetas,
};
use anchor_spl::token_interface::TokenAccount;
use cc_token::{
    accounts,
    constants::{
        COLLATERAL_SEED, COLLECTION_SEED, CONDITION_SEED, ROOT_COLLECTION_ID, STATE_VERSION,
        VAULT_SEED,
    },
    identity::derive_collection_id,
    instruction,
    instructions::{
        definitions::RegisterCollectionArgs, setup::PrepareConditionArgs,
    },
    math::IndexSet,
    state::{CollateralConfig, CollectionDefinition, Condition},
    ID,
};
use litesvm::{types::TransactionMetadata, LiteSVM};
use litesvm_token::CreateMint;
use solana_account::Account;
use solana_address::Address;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::{v0, v1, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

const COMPUTE_UNIT_LIMIT: u32 = 1_400_000;
const COLLATERAL_DECIMALS: u8 = 6;

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

    fn create_mint(&mut self, token_program: Address, decimals: u8) -> Address {
        CreateMint::new(&mut self.svm, &self.payer)
            .token_program_id(&token_program)
            .decimals(decimals)
            .send()
            .unwrap()
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

    fn collection(&self, collection_id: [u8; 32]) -> CollectionDefinition {
        deserialize_account(
            &self
                .svm
                .get_account(&collection_address(collection_id))
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

fn collection_address(collection_id: [u8; 32]) -> Address {
    Address::find_program_address(&[COLLECTION_SEED, &collection_id], &ID).0
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

fn register_collection_instruction(
    payer: Address,
    args: RegisterCollectionArgs,
    parent_collection: Option<Address>,
) -> Instruction {
    Instruction {
        program_id: ID,
        accounts: accounts::RegisterCollection {
            payer,
            condition: condition_address(args.condition_id),
            collection: collection_address(args.collection_id),
            system_program: System::id(),
            parent_collection,
        }
        .to_account_metas(None),
        data: instruction::RegisterCollection { args }.data(),
    }
}

fn register_args(
    parent_collection_id: [u8; 32],
    condition_id: [u8; 32],
    index_set: IndexSet,
) -> RegisterCollectionArgs {
    RegisterCollectionArgs {
        collection_id: derive_collection_id(parent_collection_id, condition_id, index_set)
            .unwrap()
            .collection_id,
        parent_collection_id,
        condition_id,
        index_set,
    }
}

fn collateral_config_address(mint: Address) -> Address {
    Address::find_program_address(&[COLLATERAL_SEED, mint.as_ref()], &ID).0
}

fn vault_address(mint: Address) -> Address {
    Address::find_program_address(&[VAULT_SEED, mint.as_ref()], &ID).0
}

fn register_collateral_instruction(
    payer: Address,
    mint: Address,
    token_program: Address,
) -> Instruction {
    Instruction {
        program_id: ID,
        accounts: accounts::RegisterCollateral {
            payer,
            mint,
            config: collateral_config_address(mint),
            vault: vault_address(mint),
            token_program,
            system_program: System::id(),
        }
        .to_account_metas(None),
        data: instruction::RegisterCollateral {}.data(),
    }
}

fn deserialize_account<T: AccountDeserialize>(data: &[u8]) -> T {
    T::try_deserialize(&mut data.as_ref()).unwrap()
}

fn serialize_account<T: AccountSerialize>(account: &T, size: usize) -> Vec<u8> {
    let mut data = Vec::with_capacity(size);
    account.try_serialize(&mut data).unwrap();
    data.resize(size, 0);
    data
}

fn assert_within_transaction_limit(metadata: &TransactionMetadata) {
    assert!(metadata.compute_units_consumed <= u64::from(COMPUTE_UNIT_LIMIT));
}

#[test]
fn collateral_registration_creates_config_and_vault_once() {
    let mut context = TestContext::new();
    let payer = context.payer.pubkey();

    for token_program in [anchor_spl::token::ID, anchor_spl::token_2022::ID] {
        let mint = context.create_mint(token_program, COLLATERAL_DECIMALS);
        let instruction = register_collateral_instruction(payer, mint, token_program);
        let fresh = context
            .send(instruction.clone(), TransactionVersion::V0)
            .unwrap();
        assert_within_transaction_limit(&fresh);

        let (config_address, config_bump) =
            Address::find_program_address(&[COLLATERAL_SEED, mint.as_ref()], &ID);
        let (vault_address, vault_bump) =
            Address::find_program_address(&[VAULT_SEED, mint.as_ref()], &ID);
        let config_account = context.svm.get_account(&config_address).unwrap();
        assert_eq!(config_account.owner, ID);
        let config: CollateralConfig = deserialize_account(&config_account.data);
        assert_eq!(config.mint, mint);
        assert_eq!(config.bump, config_bump);
        assert_eq!(config.vault_bump, vault_bump);

        let vault_account = context.svm.get_account(&vault_address).unwrap();
        assert_eq!(vault_account.owner, token_program);
        let vault: TokenAccount = deserialize_account(&vault_account.data);
        assert_eq!(vault.mint, mint);
        assert_eq!(vault.owner, config_address);
        assert_eq!(vault.amount, 0);
        assert!(vault.delegate.is_none());
        assert!(vault.close_authority.is_none());

        assert!(context.send(instruction, TransactionVersion::V0).is_err());
        let unchanged: CollateralConfig =
            deserialize_account(&context.svm.get_account(&config_address).unwrap().data);
        assert_eq!(unchanged.mint, mint);

        println!(
            "register_collateral token_program={token_program} cu={}",
            fresh.compute_units_consumed
        );
    }
}

#[test]
fn invalid_collateral_leaves_no_config_or_vault() {
    let mut context = TestContext::new();
    let payer = context.payer.pubkey();

    let mismatched_mint = context.create_mint(anchor_spl::token::ID, COLLATERAL_DECIMALS);
    let not_a_mint = Keypair::new().pubkey();
    context.svm.airdrop(&not_a_mint, 10_000_000).unwrap();

    for (mint, token_program) in [
        (mismatched_mint, anchor_spl::token_2022::ID),
        (not_a_mint, anchor_spl::token::ID),
    ] {
        assert!(context
            .send(
                register_collateral_instruction(payer, mint, token_program),
                TransactionVersion::V0,
            )
            .is_err());
        assert!(context
            .svm
            .get_account(&collateral_config_address(mint))
            .is_none());
        assert!(context.svm.get_account(&vault_address(mint)).is_none());
    }
}

#[test]
fn condition_creation_is_idempotent_and_atomic() {
    let mut context = TestContext::new();
    let args = condition_args(Pubkey::new_from_array([7; 32]), [9; 32], 8);
    let instruction = prepare_condition_instruction(context.payer.pubkey(), args.clone());
    let fresh = context
        .send(instruction.clone(), TransactionVersion::V0)
        .unwrap();
    assert_within_transaction_limit(&fresh);

    let condition = context.condition(args.condition_id);
    assert_eq!(condition.version, STATE_VERSION);
    assert_eq!(condition.condition_id, args.condition_id);
    assert_eq!(condition.payout_numerators, vec![0; 8]);

    let reused = context.send(instruction, TransactionVersion::V0).unwrap();
    assert_within_transaction_limit(&reused);
    assert_eq!(context.condition(args.condition_id).condition_id, args.condition_id);

    let mut invalid_args = args;
    invalid_args.condition_id = [42; 32];
    let invalid_address = condition_address(invalid_args.condition_id);
    let error = context
        .send(
            prepare_condition_instruction(context.payer.pubkey(), invalid_args),
            TransactionVersion::V0,
        )
        .unwrap_err();
    assert!(error.meta.logs.iter().any(|log| log.contains("Condition ID")));
    assert!(context.svm.get_account(&invalid_address).is_none());

    let invalid_count = condition_args(Pubkey::new_from_array([8; 32]), [10; 32], 1);
    let invalid_count_address = condition_address(invalid_count.condition_id);
    assert!(context
        .send(
            prepare_condition_instruction(context.payer.pubkey(), invalid_count),
            TransactionVersion::V0,
        )
        .is_err());
    assert!(context
        .svm
        .get_account(&invalid_count_address)
        .is_none());

    println!(
        "prepare_condition fresh_cu={} reused_cu={}",
        fresh.compute_units_consumed, reused.compute_units_consumed
    );
}

#[test]
fn composition_supports_nested_orderings_and_multiplicity() {
    let mut context = TestContext::new();
    let condition_a = condition_args(Pubkey::new_from_array([1; 32]), [2; 32], 8);
    let condition_b = condition_args(Pubkey::new_from_array([3; 32]), [4; 32], 8);
    for args in [condition_a.clone(), condition_b.clone()] {
        context
            .send(
                prepare_condition_instruction(context.payer.pubkey(), args),
                TransactionVersion::V0,
            )
            .unwrap();
    }

    let index_a = IndexSet {
        words: [0b0000_0011, 0, 0, 0],
    };
    let index_b = IndexSet {
        words: [0b0011_0000, 0, 0, 0],
    };
    let atomic_a = register_args(ROOT_COLLECTION_ID, condition_a.condition_id, index_a);
    let atomic_b = register_args(ROOT_COLLECTION_ID, condition_b.condition_id, index_b);
    let atomic_a_meta = context
        .send(
            register_collection_instruction(context.payer.pubkey(), atomic_a.clone(), None),
            TransactionVersion::V0,
        )
        .unwrap();
    context
        .send(
            register_collection_instruction(context.payer.pubkey(), atomic_b.clone(), None),
            TransactionVersion::V1,
        )
        .unwrap();

    let a_then_b = register_args(atomic_a.collection_id, condition_b.condition_id, index_b);
    let first_witness = context
        .send(
            register_collection_instruction(
                context.payer.pubkey(),
                a_then_b.clone(),
                Some(collection_address(atomic_a.collection_id)),
            ),
            TransactionVersion::V0,
        )
        .unwrap();
    let stored_witness = context.collection(a_then_b.collection_id);

    let b_then_a = register_args(atomic_b.collection_id, condition_a.condition_id, index_a);
    assert_eq!(a_then_b.collection_id, b_then_a.collection_id);
    let alternate_order = context
        .send(
            register_collection_instruction(
                context.payer.pubkey(),
                b_then_a,
                Some(collection_address(atomic_b.collection_id)),
            ),
            TransactionVersion::V1,
        )
        .unwrap();
    assert_eq!(context.collection(a_then_b.collection_id).parent_collection_id, stored_witness.parent_collection_id);

    let repeated = register_args(atomic_a.collection_id, condition_a.condition_id, index_a);
    assert_ne!(repeated.collection_id, atomic_a.collection_id);
    context
        .send(
            register_collection_instruction(
                context.payer.pubkey(),
                repeated.clone(),
                Some(collection_address(atomic_a.collection_id)),
            ),
            TransactionVersion::V0,
        )
        .unwrap();
    assert_eq!(context.collection(repeated.collection_id).index_set, index_a);

    for metadata in [&atomic_a_meta, &first_witness, &alternate_order] {
        assert_within_transaction_limit(metadata);
    }
    println!(
        "register_collection atomic_cu={} nested_cu={} reused_cu={} atomic_hash_attempts={} nested_hash_attempts={}",
        atomic_a_meta.compute_units_consumed,
        first_witness.compute_units_consumed,
        alternate_order.compute_units_consumed,
        derive_collection_id(ROOT_COLLECTION_ID, condition_a.condition_id, index_a)
            .unwrap()
            .hash_attempts,
        derive_collection_id(atomic_a.collection_id, condition_b.condition_id, index_b)
            .unwrap()
            .hash_attempts,
    );
}

#[test]
fn invalid_subsets_parents_and_points_leave_no_collection() {
    let mut context = TestContext::new();
    let condition = condition_args(Pubkey::new_from_array([21; 32]), [22; 32], 8);
    context
        .send(
            prepare_condition_instruction(context.payer.pubkey(), condition.clone()),
            TransactionVersion::V0,
        )
        .unwrap();

    for index_set in [
        IndexSet::ZERO,
        IndexSet {
            words: [0xff, 0, 0, 0],
        },
        IndexSet {
            words: [0x100, 0, 0, 0],
        },
    ] {
        let collection_id = [index_set.words[0] as u8; 32];
        let args = RegisterCollectionArgs {
            collection_id,
            parent_collection_id: ROOT_COLLECTION_ID,
            condition_id: condition.condition_id,
            index_set,
        };
        assert!(context
            .send(
                register_collection_instruction(context.payer.pubkey(), args, None),
                TransactionVersion::V0,
            )
            .is_err());
        assert!(context.svm.get_account(&collection_address(collection_id)).is_none());
    }

    let valid_index_set = IndexSet {
        words: [1, 0, 0, 0],
    };
    let parent = register_args(ROOT_COLLECTION_ID, condition.condition_id, valid_index_set);
    context
        .send(
            register_collection_instruction(context.payer.pubkey(), parent.clone(), None),
            TransactionVersion::V0,
        )
        .unwrap();
    let wrong_parent_id = [31; 32];
    let wrong_parent_target = [32; 32];
    let wrong_parent_args = RegisterCollectionArgs {
        collection_id: wrong_parent_target,
        parent_collection_id: wrong_parent_id,
        condition_id: condition.condition_id,
        index_set: valid_index_set,
    };
    assert!(context
        .send(
            register_collection_instruction(
                context.payer.pubkey(),
                wrong_parent_args,
                Some(collection_address(parent.collection_id)),
            ),
            TransactionVersion::V0,
        )
        .is_err());
    assert!(context
        .svm
        .get_account(&collection_address(wrong_parent_target))
        .is_none());

    let malformed_parent_id = [0xff; 32];
    let malformed_parent_address = collection_address(malformed_parent_id);
    let malformed_parent = CollectionDefinition {
        version: STATE_VERSION,
        collection_id: malformed_parent_id,
        parent_collection_id: ROOT_COLLECTION_ID,
        condition_id: condition.condition_id,
        index_set: valid_index_set,
        bump: Address::find_program_address(&[COLLECTION_SEED, &malformed_parent_id], &ID).1,
    };
    context
        .svm
        .set_account(
            malformed_parent_address,
            Account {
                lamports: 10_000_000,
                data: serialize_account(&malformed_parent, CollectionDefinition::SPACE),
                owner: ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
    let malformed_target = [33; 32];
    let malformed_args = RegisterCollectionArgs {
        collection_id: malformed_target,
        parent_collection_id: malformed_parent_id,
        condition_id: condition.condition_id,
        index_set: valid_index_set,
    };
    assert!(context
        .send(
            register_collection_instruction(
                context.payer.pubkey(),
                malformed_args,
                Some(malformed_parent_address),
            ),
            TransactionVersion::V0,
        )
        .is_err());
    assert!(context
        .svm
        .get_account(&collection_address(malformed_target))
        .is_none());
    assert_eq!(
        context.collection(malformed_parent_id).collection_id,
        malformed_parent_id
    );
}
