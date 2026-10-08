use std::path::PathBuf;

use anchor_lang::{
    prelude::{AccountDeserialize, AccountSerialize, Pubkey, System},
    Id, InstructionData, ToAccountMetas,
};
use anchor_spl::{
    associated_token::{self, get_associated_token_address_with_program_id},
    token_interface::TokenAccount,
};
use cc_token::{
    accounts,
    constants::{
        BALANCE_SEED, COLLATERAL_POLICY_VERSION, COLLATERAL_SEED, COLLECTION_SEED,
        CONDITION_SEED, POSITION_SEED, ROOT_COLLECTION_ID, STATE_VERSION, VAULT_SEED,
    },
    identity::{derive_collection_id, derive_position_id},
    instruction,
    instructions::{
        definitions::{RegisterCollectionArgs, RegisterPositionArgs},
        positions::{
            BatchTransferPositionsArgs, NativePositionArgs, RootCollateralArgs,
            TransferPositionArgs,
        },
        settlement::{RedeemPositionArgs, ReportPayoutsArgs},
        setup::PrepareConditionArgs,
    },
    math::IndexSet,
    state::{
        CollateralConfig, CollectionDefinition, Condition, PositionBalance, PositionDefinition,
    },
    ID,
};
use litesvm::{types::TransactionMetadata, LiteSVM};
use litesvm_token::{
    spl_token::{
        extension::{transfer_fee::instruction::initialize_transfer_fee_config, ExtensionType},
        instruction::initialize_mint2,
        state::Mint,
    },
    CreateAssociatedTokenAccount, CreateMint, FreezeAccount, MintTo,
};
use solana_account::Account;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::{v0, v1, AddressLookupTableAccount, VersionedMessage};
use solana_signer::Signer;
use solana_system_interface::instruction::create_account;
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

    fn transaction_size(&self, instruction: Instruction, version: TransactionVersion) -> usize {
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
        wincode::serialize(&transaction).unwrap().len()
    }

    fn transaction_size_with_lookup(
        &self,
        instruction: Instruction,
        fixed_account_count: usize,
    ) -> usize {
        let payer = self.payer.pubkey();
        let lookup_table = AddressLookupTableAccount {
            key: Address::new_unique(),
            addresses: instruction
                .accounts
                .iter()
                .skip(fixed_account_count)
                .map(|account| account.pubkey)
                .collect(),
        };
        let message = VersionedMessage::V0(
            v0::Message::try_compile(
                &payer,
                &[instruction],
                &[lookup_table],
                self.svm.latest_blockhash(),
            )
            .unwrap(),
        );
        let transaction = VersionedTransaction::try_new(message, &[&self.payer]).unwrap();
        wincode::serialize(&transaction).unwrap().len()
    }

    fn create_mint(&mut self, token_program: Address, freeze_authority: Option<Address>) -> Address {
        let mut builder = CreateMint::new(&mut self.svm, &self.payer)
            .token_program_id(&token_program)
            .decimals(COLLATERAL_DECIMALS);
        if let Some(freeze_authority) = freeze_authority.as_ref() {
            builder = builder.freeze_authority(freeze_authority);
        }
        builder.send().unwrap()
    }

    fn create_transfer_fee_mint(&mut self) -> Address {
        let mint = Keypair::new();
        let payer = self.payer.pubkey();
        let token_program = anchor_spl::token_2022::ID;
        let size =
            ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::TransferFeeConfig])
                .unwrap();
        let instructions = [
            create_account(
                &payer,
                &mint.pubkey(),
                self.svm.minimum_balance_for_rent_exemption(size),
                size as u64,
                &token_program,
            ),
            initialize_transfer_fee_config(&token_program, &mint.pubkey(), None, None, 100, u64::MAX)
                .unwrap(),
            initialize_mint2(&token_program, &mint.pubkey(), &payer, None, COLLATERAL_DECIMALS)
                .unwrap(),
        ];
        let message = VersionedMessage::V0(
            v0::Message::try_compile(&payer, &instructions, &[], self.svm.latest_blockhash())
                .unwrap(),
        );
        let transaction = VersionedTransaction::try_new(message, &[&self.payer, &mint]).unwrap();
        self.svm.send_transaction(transaction).unwrap();
        mint.pubkey()
    }

    fn create_funded_collateral(
        &mut self,
        token_program: Address,
        amount: u64,
    ) -> (Address, Address) {
        let mint = self.create_mint(token_program, None);
        let owner_account = CreateAssociatedTokenAccount::new(&mut self.svm, &self.payer, &mint)
            .token_program_id(&token_program)
            .send()
            .unwrap();
        MintTo::new(
            &mut self.svm,
            &self.payer,
            &mint,
            &owner_account,
            amount,
        )
        .token_program_id(&token_program)
        .send()
        .unwrap();
        (mint, owner_account)
    }

    fn collateral_config(&self, mint: Address) -> CollateralConfig {
        deserialize_account(
            &self
                .svm
                .get_account(&collateral_config_address(mint))
                .unwrap()
                .data,
        )
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

    fn position(&self, position_id: [u8; 32]) -> PositionDefinition {
        deserialize_account(
            &self
                .svm
                .get_account(&position_address(position_id))
                .unwrap()
                .data,
        )
    }

    fn balance(&self, owner: Address, position_id: [u8; 32]) -> PositionBalance {
        deserialize_account(
            &self
                .svm
                .get_account(&balance_address(owner, position_id))
                .unwrap()
                .data,
        )
    }

    fn token_amount(&self, token_account: Address) -> u64 {
        deserialize_account::<TokenAccount>(&self.svm.get_account(&token_account).unwrap().data)
            .amount
    }

    fn send_with_owner(
        &mut self,
        instruction: Instruction,
        owner: &Keypair,
    ) -> Result<TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
        self.svm.expire_blockhash();
        let payer = self.payer.pubkey();
        let message = VersionedMessage::V0(
            v0::Message::try_compile(
                &payer,
                &[instruction],
                &[],
                self.svm.latest_blockhash(),
            )
            .unwrap(),
        );
        let transaction =
            VersionedTransaction::try_new(message, &[&self.payer, owner]).unwrap();
        self.svm.send_transaction(transaction)
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

fn position_address(position_id: [u8; 32]) -> Address {
    Address::find_program_address(&[POSITION_SEED, &position_id], &ID).0
}

fn balance_address(owner: Address, position_id: [u8; 32]) -> Address {
    Address::find_program_address(&[BALANCE_SEED, owner.as_ref(), &position_id], &ID).0
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

fn register_position_instruction(payer: Address, args: RegisterPositionArgs) -> Instruction {
    Instruction {
        program_id: ID,
        accounts: accounts::RegisterPosition {
            payer,
            collateral_config: collateral_config_address(args.collateral_mint),
            collection: collection_address(args.collection_id),
            position: position_address(args.position_id),
            system_program: System::id(),
        }
        .to_account_metas(None),
        data: instruction::RegisterPosition { args }.data(),
    }
}

fn initialize_balance_instruction(
    payer: Address,
    owner: Address,
    position_id: [u8; 32],
) -> Instruction {
    Instruction {
        program_id: ID,
        accounts: accounts::InitializeBalance {
            payer,
            owner,
            position: position_address(position_id),
            balance: balance_address(owner, position_id),
            system_program: System::id(),
        }
        .to_account_metas(None),
        data: instruction::InitializeBalance {}.data(),
    }
}

fn close_balance_instruction(
    owner: Address,
    position_id: [u8; 32],
    balance: Address,
) -> Instruction {
    Instruction {
        program_id: ID,
        accounts: accounts::CloseBalance {
            owner,
            position: position_address(position_id),
            balance,
        }
        .to_account_metas(None),
        data: instruction::CloseBalance {}.data(),
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

fn root_position_accounts(
    owner: Address,
    mint: Address,
    condition_id: [u8; 32],
    partition: &[IndexSet],
) -> Vec<AccountMeta> {
    partition
        .iter()
        .flat_map(|index_set| {
            let collection_id =
                derive_collection_id(ROOT_COLLECTION_ID, condition_id, *index_set)
                    .unwrap()
                    .collection_id;
            let position_id = derive_position_id(&mint, collection_id).unwrap();
            [
                AccountMeta::new_readonly(position_address(position_id), false),
                AccountMeta::new(balance_address(owner, position_id), false),
            ]
        })
        .collect()
}

fn split_from_collateral_instruction(
    owner: Address,
    owner_source: Address,
    mint: Address,
    token_program: Address,
    args: RootCollateralArgs,
) -> Instruction {
    let mut account_metas = accounts::SplitFromCollateral {
        owner,
        owner_source,
        mint,
        collateral_config: collateral_config_address(mint),
        vault_authority: vault_authority_address(mint),
        vault: vault_address(mint, token_program),
        condition: condition_address(args.condition_id),
        token_program,
    }
    .to_account_metas(None);
    account_metas.extend(root_position_accounts(
        owner,
        mint,
        args.condition_id,
        &args.partition,
    ));
    Instruction {
        program_id: ID,
        accounts: account_metas,
        data: instruction::SplitFromCollateral { args }.data(),
    }
}

fn merge_to_collateral_instruction(
    owner: Address,
    owner_destination: Address,
    mint: Address,
    token_program: Address,
    args: RootCollateralArgs,
) -> Instruction {
    let mut account_metas = accounts::MergeToCollateral {
        owner,
        owner_destination,
        mint,
        collateral_config: collateral_config_address(mint),
        vault_authority: vault_authority_address(mint),
        vault: vault_address(mint, token_program),
        condition: condition_address(args.condition_id),
        token_program,
    }
    .to_account_metas(None);
    account_metas.extend(root_position_accounts(
        owner,
        mint,
        args.condition_id,
        &args.partition,
    ));
    Instruction {
        program_id: ID,
        accounts: account_metas,
        data: instruction::MergeToCollateral { args }.data(),
    }
}

fn native_position_accounts(
    owner: Address,
    mint: Address,
    parent_collection_id: [u8; 32],
    condition_id: [u8; 32],
    partition: &[IndexSet],
) -> Vec<AccountMeta> {
    partition
        .iter()
        .flat_map(|index_set| {
            let collection_id =
                derive_collection_id(parent_collection_id, condition_id, *index_set)
                    .unwrap()
                    .collection_id;
            let position_id = derive_position_id(&mint, collection_id).unwrap();
            [
                AccountMeta::new_readonly(position_address(position_id), false),
                AccountMeta::new(balance_address(owner, position_id), false),
            ]
        })
        .collect()
}

fn split_position_instruction(
    owner: Address,
    mint: Address,
    source_collection_id: [u8; 32],
    args: NativePositionArgs,
) -> Instruction {
    let source_position_id = derive_position_id(&mint, source_collection_id).unwrap();
    let parent_collection = (args.parent_collection_id != ROOT_COLLECTION_ID)
        .then(|| collection_address(args.parent_collection_id));
    let mut account_metas = accounts::SplitPosition {
        owner,
        condition: condition_address(args.condition_id),
        source_position: position_address(source_position_id),
        source_balance: balance_address(owner, source_position_id),
        parent_collection,
    }
    .to_account_metas(None);
    account_metas.extend(native_position_accounts(
        owner,
        mint,
        args.parent_collection_id,
        args.condition_id,
        &args.partition,
    ));
    Instruction {
        program_id: ID,
        accounts: account_metas,
        data: instruction::SplitPosition { args }.data(),
    }
}

fn merge_positions_instruction(
    owner: Address,
    mint: Address,
    destination_collection_id: [u8; 32],
    args: NativePositionArgs,
) -> Instruction {
    let destination_position_id = derive_position_id(&mint, destination_collection_id).unwrap();
    let parent_collection = (args.parent_collection_id != ROOT_COLLECTION_ID)
        .then(|| collection_address(args.parent_collection_id));
    let mut account_metas = accounts::MergePositions {
        owner,
        condition: condition_address(args.condition_id),
        destination_position: position_address(destination_position_id),
        destination_balance: balance_address(owner, destination_position_id),
        parent_collection,
    }
    .to_account_metas(None);
    account_metas.extend(native_position_accounts(
        owner,
        mint,
        args.parent_collection_id,
        args.condition_id,
        &args.partition,
    ));
    Instruction {
        program_id: ID,
        accounts: account_metas,
        data: instruction::MergePositions { args }.data(),
    }
}

fn transfer_position_instruction(
    owner: Address,
    recipient: Address,
    position_id: [u8; 32],
    amount: u64,
) -> Instruction {
    let mut accounts = accounts::TransferPosition {
        owner,
        recipient,
        position: position_address(position_id),
        source_balance: balance_address(owner, position_id),
        system_program: System::id(),
    }
    .to_account_metas(None);
    accounts.push(AccountMeta::new(
        balance_address(recipient, position_id),
        false,
    ));
    Instruction {
        program_id: ID,
        accounts,
        data: instruction::TransferPosition {
            args: TransferPositionArgs { amount },
        }
        .data(),
    }
}

fn batch_transfer_position_accounts(
    owner: Address,
    recipient: Address,
    position_ids: &[[u8; 32]],
) -> Vec<AccountMeta> {
    position_ids
        .iter()
        .flat_map(|position_id| {
            [
                AccountMeta::new_readonly(position_address(*position_id), false),
                AccountMeta::new(balance_address(owner, *position_id), false),
                AccountMeta::new(balance_address(recipient, *position_id), false),
            ]
        })
        .collect()
}

fn batch_transfer_positions_instruction(
    owner: Address,
    recipient: Address,
    position_ids: &[[u8; 32]],
    amounts: Vec<u64>,
) -> Instruction {
    let mut account_metas = accounts::BatchTransferPositions { owner, recipient }
        .to_account_metas(None);
    account_metas.extend(batch_transfer_position_accounts(
        owner,
        recipient,
        position_ids,
    ));
    Instruction {
        program_id: ID,
        accounts: account_metas,
        data: instruction::BatchTransferPositions {
            args: BatchTransferPositionsArgs { amounts },
        }
        .data(),
    }
}

fn redeem_position_instruction(
    owner: Address,
    mint: Address,
    parent_collection_id: [u8; 32],
    args: RedeemPositionArgs,
) -> Instruction {
    let source_collection_id = derive_collection_id(
        parent_collection_id,
        args.condition_id,
        args.index_set,
    )
    .unwrap()
    .collection_id;
    let source_position_id = derive_position_id(&mint, source_collection_id).unwrap();
    let destination_position_id = derive_position_id(&mint, parent_collection_id).unwrap();
    Instruction {
        program_id: ID,
        accounts: accounts::RedeemPosition {
            owner,
            condition: condition_address(args.condition_id),
            parent_collection: collection_address(parent_collection_id),
            source_position: position_address(source_position_id),
            source_balance: balance_address(owner, source_position_id),
            destination_position: position_address(destination_position_id),
            destination_balance: balance_address(owner, destination_position_id),
            system_program: System::id(),
        }
        .to_account_metas(None),
        data: instruction::RedeemPosition { args }.data(),
    }
}

fn redeem_to_collateral_instruction(
    owner: Address,
    owner_destination: Address,
    mint: Address,
    token_program: Address,
    args: RedeemPositionArgs,
) -> Instruction {
    let source_collection_id =
        derive_collection_id(ROOT_COLLECTION_ID, args.condition_id, args.index_set)
            .unwrap()
            .collection_id;
    let source_position_id = derive_position_id(&mint, source_collection_id).unwrap();
    Instruction {
        program_id: ID,
        accounts: accounts::RedeemToCollateral {
            owner,
            owner_destination,
            mint,
            collateral_config: collateral_config_address(mint),
            vault_authority: vault_authority_address(mint),
            vault: vault_address(mint, token_program),
            condition: condition_address(args.condition_id),
            source_position: position_address(source_position_id),
            source_balance: balance_address(owner, source_position_id),
            token_program,
        }
        .to_account_metas(None),
        data: instruction::RedeemToCollateral { args }.data(),
    }
}

fn singleton_partition(outcome_count: u16) -> Vec<IndexSet> {
    (0..outcome_count)
        .map(|outcome| {
            let mut words = [0; 4];
            words[usize::from(outcome / 64)] = 1 << (outcome % 64);
            IndexSet { words }
        })
        .collect()
}

fn prepare_root_positions(
    context: &mut TestContext,
    mint: Address,
    outcome_count: u16,
    resolver: Pubkey,
) -> (PrepareConditionArgs, Vec<IndexSet>, Vec<[u8; 32]>) {
    let payer = context.payer.pubkey();
    let condition = condition_args(
        resolver,
        [outcome_count as u8 + 80; 32],
        outcome_count,
    );
    context
        .send(
            prepare_condition_instruction(payer, condition.clone()),
            TransactionVersion::V0,
        )
        .unwrap();

    let partition = singleton_partition(outcome_count);
    let mut position_ids = Vec::with_capacity(partition.len());
    for index_set in &partition {
        let collection = register_args(ROOT_COLLECTION_ID, condition.condition_id, *index_set);
        context
            .send(
                register_collection_instruction(payer, collection.clone(), None),
                TransactionVersion::V0,
            )
            .unwrap();
        let position_id = derive_position_id(&mint, collection.collection_id).unwrap();
        context
            .send(
                register_position_instruction(
                    payer,
                    RegisterPositionArgs {
                        position_id,
                        collateral_mint: mint,
                        collection_id: collection.collection_id,
                    },
                ),
                TransactionVersion::V0,
            )
            .unwrap();
        context
            .send(
                initialize_balance_instruction(payer, payer, position_id),
                TransactionVersion::V0,
            )
            .unwrap();
        position_ids.push(position_id);
    }
    (condition, partition, position_ids)
}

fn prepare_position(
    context: &mut TestContext,
    mint: Address,
    parent_collection_id: [u8; 32],
    condition_id: [u8; 32],
    index_set: IndexSet,
) -> ([u8; 32], [u8; 32]) {
    let payer = context.payer.pubkey();
    let collection = register_args(parent_collection_id, condition_id, index_set);
    let parent_collection = (parent_collection_id != ROOT_COLLECTION_ID)
        .then(|| collection_address(parent_collection_id));
    context
        .send(
            register_collection_instruction(payer, collection.clone(), parent_collection),
            TransactionVersion::V0,
        )
        .unwrap();
    let position_id = derive_position_id(&mint, collection.collection_id).unwrap();
    context
        .send(
            register_position_instruction(
                payer,
                RegisterPositionArgs {
                    position_id,
                    collateral_mint: mint,
                    collection_id: collection.collection_id,
                },
            ),
            TransactionVersion::V0,
        )
        .unwrap();
    context
        .send(
            initialize_balance_instruction(payer, payer, position_id),
            TransactionVersion::V0,
        )
        .unwrap();
    (collection.collection_id, position_id)
}

fn index_set(outcomes: &[u16]) -> IndexSet {
    let mut words = [0; 4];
    for outcome in outcomes {
        words[usize::from(outcome / 64)] |= 1 << (outcome % 64);
    }
    IndexSet { words }
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

fn vault_authority_address(mint: Address) -> Address {
    Address::find_program_address(&[VAULT_SEED, mint.as_ref()], &ID).0
}

fn vault_address(mint: Address, token_program: Address) -> Address {
    get_associated_token_address_with_program_id(
        &vault_authority_address(mint),
        &mint,
        &token_program,
    )
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
            vault_authority: vault_authority_address(mint),
            vault: vault_address(mint, token_program),
            token_program,
            associated_token_program: associated_token::ID,
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
fn collateral_registration_is_idempotent_for_supported_mints() {
    let mut context = TestContext::new();
    let payer = context.payer.pubkey();

    for (token_program, freeze_authority) in [
        (anchor_spl::token::ID, None),
        (anchor_spl::token::ID, Some(payer)),
        (anchor_spl::token_2022::ID, None),
        (anchor_spl::token_2022::ID, Some(payer)),
    ] {
        let mint = context.create_mint(token_program, freeze_authority);
        let instruction = register_collateral_instruction(payer, mint, token_program);
        let fresh = context
            .send(instruction.clone(), TransactionVersion::V0)
            .unwrap();
        assert_within_transaction_limit(&fresh);

        let (config_address, config_bump) =
            Address::find_program_address(&[COLLATERAL_SEED, mint.as_ref()], &ID);
        let (vault_authority, vault_authority_bump) =
            Address::find_program_address(&[VAULT_SEED, mint.as_ref()], &ID);
        let vault_address = vault_address(mint, token_program);
        assert_eq!(context.svm.get_account(&config_address).unwrap().owner, ID);
        let config = context.collateral_config(mint);
        assert_eq!(config.version, STATE_VERSION);
        assert_eq!(config.policy_version, COLLATERAL_POLICY_VERSION);
        assert_eq!(config.mint, mint);
        assert_eq!(config.token_program, token_program);
        assert_eq!(config.decimals, COLLATERAL_DECIMALS);
        assert_eq!(config.vault, vault_address);
        assert_eq!(config.bump, config_bump);
        assert_eq!(config.vault_authority_bump, vault_authority_bump);

        let vault_account = context.svm.get_account(&vault_address).unwrap();
        assert_eq!(vault_account.owner, token_program);
        let vault: TokenAccount = deserialize_account(&vault_account.data);
        assert_eq!(vault.mint, mint);
        assert_eq!(vault.owner, vault_authority);
        assert_eq!(vault.amount, 0);
        assert!(vault.delegate.is_none());
        assert!(vault.close_authority.is_none());
        assert!(context.svm.get_account(&vault_authority).is_none());

        let config_before = context.svm.get_account(&config_address).unwrap().data;
        let reused = context.send(instruction, TransactionVersion::V0).unwrap();
        assert_within_transaction_limit(&reused);
        assert_eq!(
            context.svm.get_account(&config_address).unwrap().data,
            config_before
        );

        println!(
            "register_collateral token_program={token_program} fresh_cu={} reused_cu={}",
            fresh.compute_units_consumed, reused.compute_units_consumed
        );
    }
}

#[test]
fn unsupported_collateral_leaves_no_config_or_vault() {
    let mut context = TestContext::new();
    let payer = context.payer.pubkey();

    let mismatched_mint = context.create_mint(anchor_spl::token::ID, None);
    let not_a_mint = Keypair::new().pubkey();
    context.svm.airdrop(&not_a_mint, 10_000_000).unwrap();
    let transfer_fee_mint = context.create_transfer_fee_mint();

    for (mint, token_program, expected_log) in [
        (mismatched_mint, anchor_spl::token_2022::ID, None),
        (not_a_mint, anchor_spl::token::ID, None),
        (
            transfer_fee_mint,
            anchor_spl::token_2022::ID,
            Some("UnsupportedCollateralExtension"),
        ),
    ] {
        let error = context
            .send(
                register_collateral_instruction(payer, mint, token_program),
                TransactionVersion::V0,
            )
            .unwrap_err();
        if let Some(expected_log) = expected_log {
            assert!(error.meta.logs.iter().any(|log| log.contains(expected_log)));
        }
        assert!(context
            .svm
            .get_account(&collateral_config_address(mint))
            .is_none());
        assert!(context
            .svm
            .get_account(&vault_address(mint, token_program))
            .is_none());
    }
}

#[test]
fn position_definitions_and_balances_are_canonical_and_reopenable() {
    let mut context = TestContext::new();
    let payer = context.payer.pubkey();
    let mint = context.create_mint(anchor_spl::token::ID, None);
    context
        .send(
            register_collateral_instruction(payer, mint, anchor_spl::token::ID),
            TransactionVersion::V0,
        )
        .unwrap();

    let condition = condition_args(Pubkey::new_from_array([41; 32]), [42; 32], 2);
    context
        .send(
            prepare_condition_instruction(payer, condition.clone()),
            TransactionVersion::V0,
        )
        .unwrap();
    let collection = register_args(
        ROOT_COLLECTION_ID,
        condition.condition_id,
        IndexSet {
            words: [1, 0, 0, 0],
        },
    );
    context
        .send(
            register_collection_instruction(payer, collection.clone(), None),
            TransactionVersion::V0,
        )
        .unwrap();

    let position_id = derive_position_id(&mint, collection.collection_id).unwrap();
    let position_args = RegisterPositionArgs {
        position_id,
        collateral_mint: mint,
        collection_id: collection.collection_id,
    };
    let register_position = register_position_instruction(payer, position_args.clone());
    let created = context
        .send(register_position.clone(), TransactionVersion::V0)
        .unwrap();
    let position_before = context
        .svm
        .get_account(&position_address(position_id))
        .unwrap()
        .data;
    let reused = context
        .send(register_position, TransactionVersion::V0)
        .unwrap();
    assert_eq!(
        context
            .svm
            .get_account(&position_address(position_id))
            .unwrap()
            .data,
        position_before
    );
    let position = context.position(position_id);
    assert_eq!(position.version, STATE_VERSION);
    assert_eq!(position.position_id, position_id);
    assert_eq!(position.collateral_mint, mint);
    assert_eq!(position.collection_id, collection.collection_id);

    let owner = Keypair::new();
    context.svm.airdrop(&owner.pubkey(), 1_000_000).unwrap();
    let initialize = initialize_balance_instruction(payer, owner.pubkey(), position_id);
    let initialized = context
        .send(initialize.clone(), TransactionVersion::V0)
        .unwrap();
    context
        .send(initialize.clone(), TransactionVersion::V0)
        .unwrap();
    let balance = context.balance(owner.pubkey(), position_id);
    assert_eq!(balance.version, STATE_VERSION);
    assert_eq!(balance.owner, owner.pubkey());
    assert_eq!(balance.position_id, position_id);
    assert_eq!(balance.amount, 0);

    let balance_address = balance_address(owner.pubkey(), position_id);
    let attacker = Keypair::new();
    context.svm.airdrop(&attacker.pubkey(), 1_000_000).unwrap();
    let unauthorized = close_balance_instruction(attacker.pubkey(), position_id, balance_address);
    assert!(context.send_with_owner(unauthorized, &attacker).is_err());
    assert!(context.svm.get_account(&balance_address).is_some());

    let mut stored_account = context.svm.get_account(&balance_address).unwrap();
    let mut stored_balance: PositionBalance = deserialize_account(&stored_account.data);
    stored_balance.amount = 1;
    stored_account.data = serialize_account(&stored_balance, PositionBalance::SPACE);
    context
        .svm
        .set_account(balance_address, stored_account.clone())
        .unwrap();
    let close = close_balance_instruction(owner.pubkey(), position_id, balance_address);
    let error = context.send_with_owner(close.clone(), &owner).unwrap_err();
    assert!(error
        .meta
        .logs
        .iter()
        .any(|log| log.contains("nonzero position balance")));

    stored_balance.amount = 0;
    stored_account.data = serialize_account(&stored_balance, PositionBalance::SPACE);
    context
        .svm
        .set_account(balance_address, stored_account)
        .unwrap();
    let owner_lamports_before = context.svm.get_balance(&owner.pubkey()).unwrap();
    context.send_with_owner(close, &owner).unwrap();
    assert!(context.svm.get_account(&balance_address).is_none());
    assert!(context.svm.get_balance(&owner.pubkey()).unwrap() > owner_lamports_before);

    context
        .send(initialize, TransactionVersion::V0)
        .unwrap();
    assert_eq!(context.balance(owner.pubkey(), position_id).amount, 0);

    let invalid_position_id = [77; 32];
    let invalid_args = RegisterPositionArgs {
        position_id: invalid_position_id,
        ..position_args
    };
    let error = context
        .send(
            register_position_instruction(payer, invalid_args),
            TransactionVersion::V0,
        )
        .unwrap_err();
    assert!(error.meta.logs.iter().any(|log| log.contains("Position ID")));
    assert!(context
        .svm
        .get_account(&position_address(invalid_position_id))
        .is_none());

    for metadata in [&created, &reused, &initialized] {
        assert_within_transaction_limit(metadata);
    }
}

#[test]
fn root_collateral_split_and_merge_are_exact_for_both_token_programs() {
    for token_program in [anchor_spl::token::ID, anchor_spl::token_2022::ID] {
        let mut context = TestContext::new();
        let payer = context.payer.pubkey();
        let (mint, owner_account) = context.create_funded_collateral(token_program, 1_000);
        context
            .send(
                register_collateral_instruction(payer, mint, token_program),
                TransactionVersion::V0,
            )
            .unwrap();
        let (condition, partition, position_ids) =
            prepare_root_positions(&mut context, mint, 2, payer);
        let vault = vault_address(mint, token_program);

        for amount in [400, 100] {
            let metadata = context
                .send(
                    split_from_collateral_instruction(
                        payer,
                        owner_account,
                        mint,
                        token_program,
                        RootCollateralArgs {
                            condition_id: condition.condition_id,
                            partition: partition.clone(),
                            amount,
                        },
                    ),
                    TransactionVersion::V0,
                )
                .unwrap();
            assert_within_transaction_limit(&metadata);
        }
        assert_eq!(context.token_amount(owner_account), 500);
        assert_eq!(context.token_amount(vault), 500);
        for position_id in &position_ids {
            assert_eq!(context.balance(payer, *position_id).amount, 500);
        }

        MintTo::new(&mut context.svm, &context.payer, &mint, &vault, 23)
            .token_program_id(&token_program)
            .send()
            .unwrap();
        for amount in [250, 250] {
            let metadata = context
                .send(
                    merge_to_collateral_instruction(
                        payer,
                        owner_account,
                        mint,
                        token_program,
                        RootCollateralArgs {
                            condition_id: condition.condition_id,
                            partition: partition.clone(),
                            amount,
                        },
                    ),
                    TransactionVersion::V0,
                )
                .unwrap();
            assert_within_transaction_limit(&metadata);
        }
        assert_eq!(context.token_amount(owner_account), 1_000);
        assert_eq!(context.token_amount(vault), 23);
        for position_id in &position_ids {
            assert_eq!(context.balance(payer, *position_id).amount, 0);
        }
        context
            .send(
                report_payouts_instruction(payer, condition.condition_id, vec![1, 0]),
                TransactionVersion::V0,
            )
            .unwrap();
        let resolved_args = RootCollateralArgs {
            condition_id: condition.condition_id,
            partition: partition.clone(),
            amount: 1,
        };
        context
            .send(
                split_from_collateral_instruction(
                    payer,
                    owner_account,
                    mint,
                    token_program,
                    resolved_args.clone(),
                ),
                TransactionVersion::V0,
            )
            .unwrap();
        context
            .send(
                merge_to_collateral_instruction(
                    payer,
                    owner_account,
                    mint,
                    token_program,
                    resolved_args,
                ),
                TransactionVersion::V0,
            )
            .unwrap();

        for position_id in position_ids {
            assert_eq!(context.balance(payer, position_id).amount, 0);
            context
                .send(
                    close_balance_instruction(
                        payer,
                        position_id,
                        balance_address(payer, position_id),
                    ),
                    TransactionVersion::V0,
                )
                .unwrap();
            assert!(context
                .svm
                .get_account(&balance_address(payer, position_id))
                .is_none());
            context
                .send(
                    initialize_balance_instruction(payer, payer, position_id),
                    TransactionVersion::V0,
                )
                .unwrap();
            assert_eq!(context.balance(payer, position_id).amount, 0);
        }
    }
}

#[test]
fn root_split_capacity_is_measured_for_two_eight_and_sixteen_outputs() {
    for (outcome_count, version) in [
        (2, TransactionVersion::V0),
        (8, TransactionVersion::V1),
        (16, TransactionVersion::V1),
    ] {
        let mut context = TestContext::new();
        let payer = context.payer.pubkey();
        let token_program = anchor_spl::token::ID;
        let (mint, owner_account) = context.create_funded_collateral(token_program, 100);
        context
            .send(
                register_collateral_instruction(payer, mint, token_program),
                TransactionVersion::V0,
            )
            .unwrap();
        let (condition, partition, position_ids) =
            prepare_root_positions(
                &mut context,
                mint,
                outcome_count,
                Pubkey::new_from_array([outcome_count as u8; 32]),
            );
        let instruction = split_from_collateral_instruction(
            payer,
            owner_account,
            mint,
            token_program,
            RootCollateralArgs {
                condition_id: condition.condition_id,
                partition,
                amount: 1,
            },
        );
        let account_count = instruction.accounts.len();
        let instruction_data_bytes = instruction.data.len();
        let transaction_bytes = context.transaction_size(instruction.clone(), version);
        let lookup_transaction_bytes =
            context.transaction_size_with_lookup(instruction.clone(), 8);
        assert!(lookup_transaction_bytes <= 1_232);
        let metadata = context.send(instruction, version).unwrap();
        assert_within_transaction_limit(&metadata);
        assert!(position_ids
            .iter()
            .all(|position_id| context.balance(payer, *position_id).amount == 1));
        println!(
            "split_from_collateral outputs={outcome_count} accounts={account_count} instruction_data_bytes={instruction_data_bytes} transaction_bytes={transaction_bytes} lookup_transaction_bytes={lookup_transaction_bytes} compute_units={}",
            metadata.compute_units_consumed
        );
    }
}

#[test]
fn native_refinement_and_merge_cover_grouped_nested_and_repeated_factors() {
    let mut context = TestContext::new();
    let payer = context.payer.pubkey();
    let token_program = anchor_spl::token::ID;
    let (mint, owner_account) = context.create_funded_collateral(token_program, 1_000);
    context
        .send(
            register_collateral_instruction(payer, mint, token_program),
            TransactionVersion::V0,
        )
        .unwrap();

    let tournament = condition_args(payer, [41; 32], 8);
    context
        .send(
            prepare_condition_instruction(payer, tournament.clone()),
            TransactionVersion::V0,
        )
        .unwrap();
    let top_three = index_set(&[0, 1, 2]);
    let remaining_teams = index_set(&[3, 4, 5, 6, 7]);
    let (top_three_collection, top_three_position) = prepare_position(
        &mut context,
        mint,
        ROOT_COLLECTION_ID,
        tournament.condition_id,
        top_three,
    );
    prepare_position(
        &mut context,
        mint,
        ROOT_COLLECTION_ID,
        tournament.condition_id,
        remaining_teams,
    );
    context
        .send(
            split_from_collateral_instruction(
                payer,
                owner_account,
                mint,
                token_program,
                RootCollateralArgs {
                    condition_id: tournament.condition_id,
                    partition: vec![top_three, remaining_teams],
                    amount: 100,
                },
            ),
            TransactionVersion::V0,
        )
        .unwrap();

    let first_two = index_set(&[0, 1]);
    let third = index_set(&[2]);
    let (_, first_two_position) = prepare_position(
        &mut context,
        mint,
        ROOT_COLLECTION_ID,
        tournament.condition_id,
        first_two,
    );
    let (_, third_position) = prepare_position(
        &mut context,
        mint,
        ROOT_COLLECTION_ID,
        tournament.condition_id,
        third,
    );
    let partial_args = NativePositionArgs {
        parent_collection_id: ROOT_COLLECTION_ID,
        condition_id: tournament.condition_id,
        partition: vec![first_two, third],
        amount: 60,
    };
    context
        .send(
            split_position_instruction(
                payer,
                mint,
                top_three_collection,
                partial_args.clone(),
            ),
            TransactionVersion::V0,
        )
        .unwrap();
    assert_eq!(context.balance(payer, top_three_position).amount, 40);
    assert_eq!(context.balance(payer, first_two_position).amount, 60);
    assert_eq!(context.balance(payer, third_position).amount, 60);

    context
        .send(
            merge_positions_instruction(
                payer,
                mint,
                top_three_collection,
                NativePositionArgs {
                    amount: 25,
                    ..partial_args
                },
            ),
            TransactionVersion::V0,
        )
        .unwrap();
    assert_eq!(context.balance(payer, top_three_position).amount, 65);
    assert_eq!(context.balance(payer, first_two_position).amount, 35);
    assert_eq!(context.balance(payer, third_position).amount, 35);

    let penalties = condition_args(payer, [42; 32], 2);
    context
        .send(
            prepare_condition_instruction(payer, penalties.clone()),
            TransactionVersion::V0,
        )
        .unwrap();
    let penalty = index_set(&[0]);
    let no_penalty = index_set(&[1]);
    let (_, penalty_position) = prepare_position(
        &mut context,
        mint,
        top_three_collection,
        penalties.condition_id,
        penalty,
    );
    let (_, no_penalty_position) = prepare_position(
        &mut context,
        mint,
        top_three_collection,
        penalties.condition_id,
        no_penalty,
    );
    let nested_args = NativePositionArgs {
        parent_collection_id: top_three_collection,
        condition_id: penalties.condition_id,
        partition: vec![penalty, no_penalty],
        amount: 40,
    };
    context
        .send(
            split_position_instruction(
                payer,
                mint,
                top_three_collection,
                nested_args.clone(),
            ),
            TransactionVersion::V0,
        )
        .unwrap();
    assert_eq!(context.balance(payer, top_three_position).amount, 25);
    assert_eq!(context.balance(payer, penalty_position).amount, 40);
    assert_eq!(context.balance(payer, no_penalty_position).amount, 40);

    context
        .send(
            report_payouts_instruction(payer, penalties.condition_id, vec![1, 0]),
            TransactionVersion::V0,
        )
        .unwrap();
    context
        .send(
            merge_positions_instruction(
                payer,
                mint,
                top_three_collection,
                nested_args,
            ),
            TransactionVersion::V0,
        )
        .unwrap();
    assert_eq!(context.balance(payer, top_three_position).amount, 65);
    assert_eq!(context.balance(payer, penalty_position).amount, 0);
    assert_eq!(context.balance(payer, no_penalty_position).amount, 0);

    let repeated_group = index_set(&[0, 1]);
    let repeated_remainder = index_set(&[2, 3, 4, 5, 6, 7]);
    let (repeated_group_collection, repeated_group_position) = prepare_position(
        &mut context,
        mint,
        top_three_collection,
        tournament.condition_id,
        repeated_group,
    );
    let (_, repeated_remainder_position) = prepare_position(
        &mut context,
        mint,
        top_three_collection,
        tournament.condition_id,
        repeated_remainder,
    );
    let repeated_args = NativePositionArgs {
        parent_collection_id: top_three_collection,
        condition_id: tournament.condition_id,
        partition: vec![repeated_group, repeated_remainder],
        amount: 1,
    };
    context
        .send(
            split_position_instruction(
                payer,
                mint,
                top_three_collection,
                repeated_args.clone(),
            ),
            TransactionVersion::V0,
        )
        .unwrap();

    let repeated_first = index_set(&[0]);
    let repeated_second = index_set(&[1]);
    let mut repeated_partial_positions = Vec::new();
    for subset in [repeated_first, repeated_second] {
        let (_, position_id) = prepare_position(
            &mut context,
            mint,
            top_three_collection,
            tournament.condition_id,
            subset,
        );
        repeated_partial_positions.push(position_id);
    }
    let repeated_partial_args = NativePositionArgs {
        parent_collection_id: top_three_collection,
        condition_id: tournament.condition_id,
        partition: vec![repeated_first, repeated_second],
        amount: 1,
    };
    context
        .send(
            split_position_instruction(
                payer,
                mint,
                repeated_group_collection,
                repeated_partial_args.clone(),
            ),
            TransactionVersion::V0,
        )
        .unwrap();
    assert!(repeated_partial_positions
        .iter()
        .all(|position_id| context.balance(payer, *position_id).amount == 1));
    context
        .send(
            merge_positions_instruction(
                payer,
                mint,
                repeated_group_collection,
                repeated_partial_args,
            ),
            TransactionVersion::V0,
        )
        .unwrap();
    context
        .send(
            merge_positions_instruction(
                payer,
                mint,
                top_three_collection,
                repeated_args,
            ),
            TransactionVersion::V0,
        )
        .unwrap();

    assert_eq!(context.balance(payer, top_three_position).amount, 65);
    assert_eq!(context.balance(payer, repeated_group_position).amount, 0);
    assert_eq!(
        context.balance(payer, repeated_remainder_position).amount,
        0
    );
    assert_eq!(context.token_amount(owner_account), 900);
    assert_eq!(context.token_amount(vault_address(mint, token_program)), 100);
}

#[test]
fn native_refinement_capacity_is_measured_for_two_eight_and_sixteen_outputs() {
    for output_count in [2, 8, 16] {
        let mut context = TestContext::new();
        let payer = context.payer.pubkey();
        let token_program = anchor_spl::token::ID;
        let (mint, owner_account) = context.create_funded_collateral(token_program, 10);
        context
            .send(
                register_collateral_instruction(payer, mint, token_program),
                TransactionVersion::V0,
            )
            .unwrap();

        let (base_condition, base_partition, base_positions) =
            prepare_root_positions(&mut context, mint, 2, payer);
        context
            .send(
                split_from_collateral_instruction(
                    payer,
                    owner_account,
                    mint,
                    token_program,
                    RootCollateralArgs {
                        condition_id: base_condition.condition_id,
                        partition: base_partition.clone(),
                        amount: 1,
                    },
                ),
                TransactionVersion::V0,
            )
            .unwrap();
        let parent_collection_id = derive_collection_id(
            ROOT_COLLECTION_ID,
            base_condition.condition_id,
            base_partition[0],
        )
        .unwrap()
        .collection_id;

        let refinement = condition_args(
            Pubkey::new_from_array([output_count as u8; 32]),
            [output_count as u8 + 120; 32],
            output_count,
        );
        context
            .send(
                prepare_condition_instruction(payer, refinement.clone()),
                TransactionVersion::V0,
            )
            .unwrap();
        let partition = singleton_partition(output_count);
        let mut child_positions = Vec::with_capacity(partition.len());
        for subset in &partition {
            let (_, position_id) = prepare_position(
                &mut context,
                mint,
                parent_collection_id,
                refinement.condition_id,
                *subset,
            );
            child_positions.push(position_id);
        }

        let instruction = split_position_instruction(
            payer,
            mint,
            parent_collection_id,
            NativePositionArgs {
                parent_collection_id,
                condition_id: refinement.condition_id,
                partition,
                amount: 1,
            },
        );
        let account_count = instruction.accounts.len();
        let instruction_data_bytes = instruction.data.len();
        let transaction_bytes =
            context.transaction_size(instruction.clone(), TransactionVersion::V0);
        let lookup_transaction_bytes =
            context.transaction_size_with_lookup(instruction.clone(), 5);
        assert!(lookup_transaction_bytes <= 1_232);
        let version = if output_count == 2 {
            TransactionVersion::V0
        } else {
            TransactionVersion::V1
        };
        let metadata = context.send(instruction, version).unwrap();
        assert_within_transaction_limit(&metadata);
        assert_eq!(context.balance(payer, base_positions[0]).amount, 0);
        assert!(child_positions
            .iter()
            .all(|position_id| context.balance(payer, *position_id).amount == 1));
        println!(
            "split_position outputs={output_count} accounts={account_count} instruction_data_bytes={instruction_data_bytes} transaction_bytes={transaction_bytes} lookup_transaction_bytes={lookup_transaction_bytes} compute_units={}",
            metadata.compute_units_consumed
        );
    }
}

#[test]
fn invalid_native_transitions_leave_every_balance_unchanged() {
    let mut context = TestContext::new();
    let payer = context.payer.pubkey();
    let token_program = anchor_spl::token::ID;
    let (mint, owner_account) = context.create_funded_collateral(token_program, 20);
    context
        .send(
            register_collateral_instruction(payer, mint, token_program),
            TransactionVersion::V0,
        )
        .unwrap();
    let condition = condition_args(payer, [63; 32], 3);
    context
        .send(
            prepare_condition_instruction(payer, condition.clone()),
            TransactionVersion::V0,
        )
        .unwrap();

    let grouped = index_set(&[0, 1]);
    let complement = index_set(&[2]);
    let (grouped_collection, grouped_position) = prepare_position(
        &mut context,
        mint,
        ROOT_COLLECTION_ID,
        condition.condition_id,
        grouped,
    );
    prepare_position(
        &mut context,
        mint,
        ROOT_COLLECTION_ID,
        condition.condition_id,
        complement,
    );
    context
        .send(
            split_from_collateral_instruction(
                payer,
                owner_account,
                mint,
                token_program,
                RootCollateralArgs {
                    condition_id: condition.condition_id,
                    partition: vec![grouped, complement],
                    amount: 10,
                },
            ),
            TransactionVersion::V0,
        )
        .unwrap();

    let first = index_set(&[0]);
    let second = index_set(&[1]);
    let (_, first_position) = prepare_position(
        &mut context,
        mint,
        ROOT_COLLECTION_ID,
        condition.condition_id,
        first,
    );
    let (_, second_position) = prepare_position(
        &mut context,
        mint,
        ROOT_COLLECTION_ID,
        condition.condition_id,
        second,
    );
    let valid_args = NativePositionArgs {
        parent_collection_id: ROOT_COLLECTION_ID,
        condition_id: condition.condition_id,
        partition: vec![first, second],
        amount: 1,
    };

    for args in [
        NativePositionArgs {
            amount: 0,
            ..valid_args.clone()
        },
        NativePositionArgs {
            partition: vec![first, index_set(&[0, 1])],
            ..valid_args.clone()
        },
        NativePositionArgs {
            amount: 11,
            ..valid_args.clone()
        },
    ] {
        assert!(context
            .send(
                split_position_instruction(payer, mint, grouped_collection, args),
                TransactionVersion::V0,
            )
            .is_err());
        assert_eq!(context.balance(payer, grouped_position).amount, 10);
        assert_eq!(context.balance(payer, first_position).amount, 0);
        assert_eq!(context.balance(payer, second_position).amount, 0);
    }

    let mut missing_pair =
        split_position_instruction(payer, mint, grouped_collection, valid_args.clone());
    missing_pair.accounts.pop();
    assert!(context.send(missing_pair, TransactionVersion::V0).is_err());

    let mut wrong_order =
        split_position_instruction(payer, mint, grouped_collection, valid_args.clone());
    wrong_order.accounts.swap(5, 7);
    assert!(context.send(wrong_order, TransactionVersion::V0).is_err());

    let mut wrong_source =
        split_position_instruction(payer, mint, grouped_collection, valid_args.clone());
    wrong_source.accounts[2] = wrong_source.accounts[5].clone();
    wrong_source.accounts[3] = wrong_source.accounts[6].clone();
    assert!(context.send(wrong_source, TransactionVersion::V0).is_err());

    let mut duplicate =
        split_position_instruction(payer, mint, grouped_collection, valid_args.clone());
    duplicate.accounts[7] = duplicate.accounts[5].clone();
    assert!(context.send(duplicate, TransactionVersion::V0).is_err());

    let wrong_parent_args = NativePositionArgs {
        parent_collection_id: grouped_collection,
        ..valid_args.clone()
    };
    assert!(context
        .send(
            split_position_instruction(
                payer,
                mint,
                grouped_collection,
                wrong_parent_args,
            ),
            TransactionVersion::V0,
        )
        .is_err());

    let other_mint = context.create_mint(token_program, None);
    context
        .send(
            register_collateral_instruction(payer, other_mint, token_program),
            TransactionVersion::V0,
        )
        .unwrap();
    let (_, other_first_position) = prepare_position(
        &mut context,
        other_mint,
        ROOT_COLLECTION_ID,
        condition.condition_id,
        first,
    );
    let mut wrong_collateral =
        split_position_instruction(payer, mint, grouped_collection, valid_args.clone());
    wrong_collateral.accounts[5] =
        AccountMeta::new_readonly(position_address(other_first_position), false);
    wrong_collateral.accounts[6] =
        AccountMeta::new(balance_address(payer, other_first_position), false);
    assert!(context
        .send(wrong_collateral, TransactionVersion::V0)
        .is_err());

    let full_partition_args = NativePositionArgs {
        parent_collection_id: ROOT_COLLECTION_ID,
        condition_id: condition.condition_id,
        partition: vec![grouped, complement],
        amount: 1,
    };
    assert!(context
        .send(
            split_position_instruction(
                payer,
                mint,
                grouped_collection,
                full_partition_args,
            ),
            TransactionVersion::V0,
        )
        .is_err());

    let first_balance_address = balance_address(payer, first_position);
    let mut first_balance_account = context.svm.get_account(&first_balance_address).unwrap();
    let mut first_balance: PositionBalance = deserialize_account(&first_balance_account.data);
    first_balance.amount = u64::MAX;
    first_balance_account.data = serialize_account(&first_balance, PositionBalance::SPACE);
    context
        .svm
        .set_account(first_balance_address, first_balance_account.clone())
        .unwrap();
    assert!(context
        .send(
            split_position_instruction(payer, mint, grouped_collection, valid_args.clone()),
            TransactionVersion::V0,
        )
        .is_err());
    assert_eq!(context.balance(payer, grouped_position).amount, 10);
    assert_eq!(context.balance(payer, second_position).amount, 0);

    first_balance.amount = 0;
    first_balance_account.data = serialize_account(&first_balance, PositionBalance::SPACE);
    context
        .svm
        .set_account(first_balance_address, first_balance_account)
        .unwrap();
    context
        .send(
            split_position_instruction(payer, mint, grouped_collection, valid_args.clone()),
            TransactionVersion::V0,
        )
        .unwrap();

    let mut wrong_destination =
        merge_positions_instruction(payer, mint, grouped_collection, valid_args.clone());
    wrong_destination.accounts[2] = wrong_destination.accounts[5].clone();
    wrong_destination.accounts[3] = wrong_destination.accounts[6].clone();
    assert!(context
        .send(wrong_destination, TransactionVersion::V0)
        .is_err());
    assert_eq!(context.balance(payer, grouped_position).amount, 9);
    assert_eq!(context.balance(payer, first_position).amount, 1);
    assert_eq!(context.balance(payer, second_position).amount, 1);

    let grouped_balance_address = balance_address(payer, grouped_position);
    let mut grouped_balance_account = context.svm.get_account(&grouped_balance_address).unwrap();
    let mut grouped_balance: PositionBalance = deserialize_account(&grouped_balance_account.data);
    grouped_balance.amount = u64::MAX;
    grouped_balance_account.data = serialize_account(&grouped_balance, PositionBalance::SPACE);
    context
        .svm
        .set_account(grouped_balance_address, grouped_balance_account.clone())
        .unwrap();
    assert!(context
        .send(
            merge_positions_instruction(
                payer,
                mint,
                grouped_collection,
                valid_args.clone(),
            ),
            TransactionVersion::V0,
        )
        .is_err());
    assert_eq!(context.balance(payer, first_position).amount, 1);
    assert_eq!(context.balance(payer, second_position).amount, 1);

    grouped_balance.amount = 9;
    grouped_balance_account.data = serialize_account(&grouped_balance, PositionBalance::SPACE);
    context
        .svm
        .set_account(grouped_balance_address, grouped_balance_account)
        .unwrap();
    assert!(context
        .send(
            merge_positions_instruction(
                payer,
                mint,
                grouped_collection,
                NativePositionArgs {
                    amount: 2,
                    ..valid_args
                },
            ),
            TransactionVersion::V0,
        )
        .is_err());
    assert_eq!(context.balance(payer, grouped_position).amount, 9);
    assert_eq!(context.balance(payer, first_position).amount, 1);
    assert_eq!(context.balance(payer, second_position).amount, 1);
    assert_eq!(context.token_amount(owner_account), 10);
    assert_eq!(context.token_amount(vault_address(mint, token_program)), 10);
}

#[test]
fn single_transfers_initialize_recipients_and_preserve_exact_balances() {
    let mut context = TestContext::new();
    let payer = context.payer.pubkey();
    let token_program = anchor_spl::token::ID;
    let (mint, owner_account) = context.create_funded_collateral(token_program, 100);
    context
        .send(
            register_collateral_instruction(payer, mint, token_program),
            TransactionVersion::V0,
        )
        .unwrap();
    let (condition, partition, position_ids) = prepare_root_positions(&mut context, mint, 2, payer);
    context
        .send(
            split_from_collateral_instruction(
                payer,
                owner_account,
                mint,
                token_program,
                RootCollateralArgs {
                    condition_id: condition.condition_id,
                    partition,
                    amount: 100,
                },
            ),
            TransactionVersion::V0,
        )
        .unwrap();

    let position_id = position_ids[0];
    let recipient = Keypair::new();
    context
        .svm
        .set_account(
            balance_address(recipient.pubkey(), position_id),
            Account {
                lamports: 1,
                data: Vec::new(),
                owner: System::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
    let failed_recipient = Keypair::new().pubkey();
    assert!(context
        .send(
            transfer_position_instruction(payer, failed_recipient, position_id, 101),
            TransactionVersion::V0,
        )
        .is_err());
    assert!(context
        .svm
        .get_account(&balance_address(failed_recipient, position_id))
        .is_none());

    let metadata = context
        .send(
            transfer_position_instruction(payer, recipient.pubkey(), position_id, 40),
            TransactionVersion::V0,
        )
        .unwrap();
    assert_within_transaction_limit(&metadata);
    assert_eq!(context.balance(payer, position_id).amount, 60);
    assert_eq!(context.balance(recipient.pubkey(), position_id).amount, 40);

    assert!(context
        .send(
            transfer_position_instruction(payer, payer, position_id, 60),
            TransactionVersion::V0,
        )
        .is_err());
    assert_eq!(context.balance(payer, position_id).amount, 60);
    assert!(context
        .send(
            transfer_position_instruction(payer, recipient.pubkey(), position_id, 0),
            TransactionVersion::V0,
        )
        .is_err());

    context
        .send(
            report_payouts_instruction(payer, condition.condition_id, vec![1, 0]),
            TransactionVersion::V0,
        )
        .unwrap();
    let existing_metadata = context
        .send(
            transfer_position_instruction(payer, recipient.pubkey(), position_id, 10),
            TransactionVersion::V0,
        )
        .unwrap();
    assert_eq!(context.balance(payer, position_id).amount, 50);
    assert_eq!(context.balance(recipient.pubkey(), position_id).amount, 50);

    context
        .send_with_owner(
            transfer_position_instruction(recipient.pubkey(), payer, position_id, 50),
            &recipient,
        )
        .unwrap();
    assert_eq!(context.balance(payer, position_id).amount, 100);
    assert_eq!(context.balance(recipient.pubkey(), position_id).amount, 0);

    let destination_address = balance_address(recipient.pubkey(), position_id);
    let mut destination_account = context.svm.get_account(&destination_address).unwrap();
    let mut destination_balance: PositionBalance = deserialize_account(&destination_account.data);
    destination_balance.amount = u64::MAX;
    destination_account.data = serialize_account(&destination_balance, PositionBalance::SPACE);
    context
        .svm
        .set_account(destination_address, destination_account.clone())
        .unwrap();
    assert!(context
        .send(
            transfer_position_instruction(payer, recipient.pubkey(), position_id, 1),
            TransactionVersion::V0,
        )
        .is_err());
    assert_eq!(context.balance(payer, position_id).amount, 100);
    assert_eq!(
        context.balance(recipient.pubkey(), position_id).amount,
        u64::MAX
    );

    destination_balance.amount = 0;
    destination_account.data = serialize_account(&destination_balance, PositionBalance::SPACE);
    context
        .svm
        .set_account(destination_address, destination_account)
        .unwrap();
    let attacker = Keypair::new();
    context.svm.airdrop(&attacker.pubkey(), 1_000_000).unwrap();
    let mut unauthorized =
        transfer_position_instruction(payer, recipient.pubkey(), position_id, 1);
    unauthorized.accounts[0] = AccountMeta::new(attacker.pubkey(), true);
    assert!(context.send_with_owner(unauthorized, &attacker).is_err());

    assert_eq!(context.balance(payer, position_id).amount, 100);
    assert_eq!(context.balance(recipient.pubkey(), position_id).amount, 0);
    assert_eq!(context.token_amount(owner_account), 0);
    assert_eq!(context.token_amount(vault_address(mint, token_program)), 100);
    println!(
        "transfer_position first_use_compute_units={} existing_compute_units={}",
        metadata.compute_units_consumed, existing_metadata.compute_units_consumed
    );
}

#[test]
fn batch_transfer_capacity_is_measured_for_two_eight_and_sixteen_positions() {
    for position_count in [2, 8, 16] {
        let mut context = TestContext::new();
        let payer = context.payer.pubkey();
        let token_program = anchor_spl::token::ID;
        let (mint, owner_account) = context.create_funded_collateral(token_program, 10);
        context
            .send(
                register_collateral_instruction(payer, mint, token_program),
                TransactionVersion::V0,
            )
            .unwrap();
        let (condition, partition, position_ids) = prepare_root_positions(
            &mut context,
            mint,
            position_count,
            Pubkey::new_from_array([position_count as u8; 32]),
        );
        let root_version = if position_count == 2 {
            TransactionVersion::V0
        } else {
            TransactionVersion::V1
        };
        context
            .send(
                split_from_collateral_instruction(
                    payer,
                    owner_account,
                    mint,
                    token_program,
                    RootCollateralArgs {
                        condition_id: condition.condition_id,
                        partition,
                        amount: 5,
                    },
                ),
                root_version,
            )
            .unwrap();

        let recipient = Keypair::new().pubkey();
        for position_id in &position_ids {
            context
                .send(
                    initialize_balance_instruction(payer, recipient, *position_id),
                    TransactionVersion::V0,
                )
                .unwrap();
        }
        let instruction = batch_transfer_positions_instruction(
            payer,
            recipient,
            &position_ids,
            vec![1; position_ids.len()],
        );
        let account_count = instruction.accounts.len();
        let instruction_data_bytes = instruction.data.len();
        let transaction_bytes =
            context.transaction_size(instruction.clone(), TransactionVersion::V0);
        let lookup_transaction_bytes =
            context.transaction_size_with_lookup(instruction.clone(), 2);
        assert!(lookup_transaction_bytes <= 1_232);
        let version = if transaction_bytes <= 1_232 {
            TransactionVersion::V0
        } else {
            TransactionVersion::V1
        };
        let metadata = context.send(instruction, version).unwrap();
        assert_within_transaction_limit(&metadata);
        assert!(position_ids.iter().all(|position_id| {
            context.balance(payer, *position_id).amount == 4
                && context.balance(recipient, *position_id).amount == 1
        }));

        let self_transfer = batch_transfer_positions_instruction(
            payer,
            payer,
            &position_ids,
            vec![4; position_ids.len()],
        );
        assert!(context.send(self_transfer, version).is_err());
        assert!(position_ids
            .iter()
            .all(|position_id| context.balance(payer, *position_id).amount == 4));
        println!(
            "batch_transfer_positions positions={position_count} accounts={account_count} instruction_data_bytes={instruction_data_bytes} transaction_bytes={transaction_bytes} lookup_transaction_bytes={lookup_transaction_bytes} compute_units={}",
            metadata.compute_units_consumed
        );
    }
}

#[test]
fn invalid_batch_transfers_roll_back_every_entry() {
    let mut context = TestContext::new();
    let payer = context.payer.pubkey();
    let token_program = anchor_spl::token::ID;
    let (mint, owner_account) = context.create_funded_collateral(token_program, 10);
    context
        .send(
            register_collateral_instruction(payer, mint, token_program),
            TransactionVersion::V0,
        )
        .unwrap();
    let (condition, partition, position_ids) = prepare_root_positions(&mut context, mint, 3, payer);
    context
        .send(
            split_from_collateral_instruction(
                payer,
                owner_account,
                mint,
                token_program,
                RootCollateralArgs {
                    condition_id: condition.condition_id,
                    partition,
                    amount: 10,
                },
            ),
            TransactionVersion::V0,
        )
        .unwrap();
    let recipient = Keypair::new().pubkey();
    for position_id in &position_ids {
        context
            .send(
                initialize_balance_instruction(payer, recipient, *position_id),
                TransactionVersion::V0,
            )
            .unwrap();
    }

    let invalid = [
        batch_transfer_positions_instruction(payer, recipient, &[], vec![]),
        batch_transfer_positions_instruction(payer, recipient, &position_ids, vec![1, 0, 1]),
        batch_transfer_positions_instruction(payer, recipient, &position_ids, vec![1, 11, 1]),
    ];
    for instruction in invalid {
        assert!(context.send(instruction, TransactionVersion::V0).is_err());
        assert!(position_ids.iter().all(|position_id| {
            context.balance(payer, *position_id).amount == 10
                && context.balance(recipient, *position_id).amount == 0
        }));
    }

    let mut missing_account = batch_transfer_positions_instruction(
        payer,
        recipient,
        &position_ids,
        vec![1; position_ids.len()],
    );
    missing_account.accounts.pop();
    assert!(context
        .send(missing_account, TransactionVersion::V0)
        .is_err());

    let duplicate_ids = [position_ids[0], position_ids[0]];
    assert!(context
        .send(
            batch_transfer_positions_instruction(
                payer,
                recipient,
                &duplicate_ids,
                vec![1, 1],
            ),
            TransactionVersion::V0,
        )
        .is_err());

    let mut wrong_order = batch_transfer_positions_instruction(
        payer,
        recipient,
        &position_ids,
        vec![1; position_ids.len()],
    );
    wrong_order.accounts.swap(2, 5);
    assert!(context.send(wrong_order, TransactionVersion::V0).is_err());

    let missing_recipient = Keypair::new().pubkey();
    assert!(context
        .send(
            batch_transfer_positions_instruction(
                payer,
                missing_recipient,
                &position_ids,
                vec![1; position_ids.len()],
            ),
            TransactionVersion::V0,
        )
        .is_err());

    let second_destination = balance_address(recipient, position_ids[1]);
    let mut second_destination_account = context.svm.get_account(&second_destination).unwrap();
    let mut second_destination_balance: PositionBalance =
        deserialize_account(&second_destination_account.data);
    second_destination_balance.amount = u64::MAX;
    second_destination_account.data =
        serialize_account(&second_destination_balance, PositionBalance::SPACE);
    context
        .svm
        .set_account(second_destination, second_destination_account.clone())
        .unwrap();
    assert!(context
        .send(
            batch_transfer_positions_instruction(
                payer,
                recipient,
                &position_ids,
                vec![1; position_ids.len()],
            ),
            TransactionVersion::V0,
        )
        .is_err());
    assert_eq!(context.balance(payer, position_ids[0]).amount, 10);
    assert_eq!(context.balance(recipient, position_ids[0]).amount, 0);

    second_destination_balance.amount = 0;
    second_destination_account.data =
        serialize_account(&second_destination_balance, PositionBalance::SPACE);
    context
        .svm
        .set_account(second_destination, second_destination_account)
        .unwrap();
    let attacker = Keypair::new();
    context.svm.airdrop(&attacker.pubkey(), 1_000_000).unwrap();
    let mut unauthorized = batch_transfer_positions_instruction(
        payer,
        recipient,
        &position_ids,
        vec![1; position_ids.len()],
    );
    unauthorized.accounts[0] = AccountMeta::new(attacker.pubkey(), true);
    assert!(context.send_with_owner(unauthorized, &attacker).is_err());

    let oversized_ids = vec![position_ids[0]; 17];
    assert!(context
        .send(
            batch_transfer_positions_instruction(
                payer,
                recipient,
                &oversized_ids,
                vec![1; 17],
            ),
            TransactionVersion::V1,
        )
        .is_err());

    assert!(position_ids.iter().all(|position_id| {
        context.balance(payer, *position_id).amount == 10
            && context.balance(recipient, *position_id).amount == 0
    }));
    assert_eq!(context.token_amount(owner_account), 0);
    assert_eq!(context.token_amount(vault_address(mint, token_program)), 10);
}

#[test]
fn redemption_removes_distinct_factors_in_either_order() {
    let mut context = TestContext::new();
    let payer = context.payer.pubkey();
    let token_program = anchor_spl::token::ID;
    let (mint, owner_account) = context.create_funded_collateral(token_program, 300);
    context
        .send(
            register_collateral_instruction(payer, mint, token_program),
            TransactionVersion::V0,
        )
        .unwrap();

    let first_condition = condition_args(payer, [201; 32], 2);
    let second_condition = condition_args(payer, [202; 32], 2);
    for condition in [&first_condition, &second_condition] {
        context
            .send(
                prepare_condition_instruction(payer, condition.clone()),
                TransactionVersion::V0,
            )
            .unwrap();
    }
    let selected = index_set(&[0]);
    let complement = index_set(&[1]);
    let (first_collection, first_position) = prepare_position(
        &mut context,
        mint,
        ROOT_COLLECTION_ID,
        first_condition.condition_id,
        selected,
    );
    prepare_position(
        &mut context,
        mint,
        ROOT_COLLECTION_ID,
        first_condition.condition_id,
        complement,
    );
    context
        .send(
            split_from_collateral_instruction(
                payer,
                owner_account,
                mint,
                token_program,
                RootCollateralArgs {
                    condition_id: first_condition.condition_id,
                    partition: vec![selected, complement],
                    amount: 300,
                },
            ),
            TransactionVersion::V0,
        )
        .unwrap();

    let (combined_collection, combined_position) = prepare_position(
        &mut context,
        mint,
        first_collection,
        second_condition.condition_id,
        selected,
    );
    prepare_position(
        &mut context,
        mint,
        first_collection,
        second_condition.condition_id,
        complement,
    );
    context
        .send(
            split_position_instruction(
                payer,
                mint,
                first_collection,
                NativePositionArgs {
                    parent_collection_id: first_collection,
                    condition_id: second_condition.condition_id,
                    partition: vec![selected, complement],
                    amount: 300,
                },
            ),
            TransactionVersion::V0,
        )
        .unwrap();

    let (second_collection, second_position) = prepare_position(
        &mut context,
        mint,
        ROOT_COLLECTION_ID,
        second_condition.condition_id,
        selected,
    );
    context
        .send(
            close_balance_instruction(
                payer,
                second_position,
                balance_address(payer, second_position),
            ),
            TransactionVersion::V0,
        )
        .unwrap();
    context
        .send(
            report_payouts_instruction(payer, first_condition.condition_id, vec![1, 1]),
            TransactionVersion::V0,
        )
        .unwrap();

    let first_residual_instruction = redeem_position_instruction(
        payer,
        mint,
        second_collection,
        RedeemPositionArgs {
            condition_id: first_condition.condition_id,
            index_set: selected,
            amount: 100,
        },
    );
    let residual_transaction_bytes =
        context.transaction_size(first_residual_instruction.clone(), TransactionVersion::V0);
    let first_residual = context
        .send(first_residual_instruction, TransactionVersion::V0)
        .unwrap();
    assert_eq!(context.balance(payer, combined_position).amount, 200);
    assert_eq!(context.balance(payer, second_position).amount, 50);
    let existing_residual = context
        .send(
            redeem_position_instruction(
                payer,
                mint,
                second_collection,
                RedeemPositionArgs {
                    condition_id: first_condition.condition_id,
                    index_set: selected,
                    amount: 100,
                },
            ),
            TransactionVersion::V0,
        )
        .unwrap();
    assert_eq!(context.balance(payer, combined_position).amount, 100);
    assert_eq!(context.balance(payer, second_position).amount, 100);
    context
        .send(
            report_payouts_instruction(payer, second_condition.condition_id, vec![1, 1]),
            TransactionVersion::V0,
        )
        .unwrap();
    let first_collateral = context
        .send(
            redeem_to_collateral_instruction(
                payer,
                owner_account,
                mint,
                token_program,
                RedeemPositionArgs {
                    condition_id: second_condition.condition_id,
                    index_set: selected,
                    amount: 100,
                },
            ),
            TransactionVersion::V0,
        )
        .unwrap();

    context
        .send(
            redeem_position_instruction(
                payer,
                mint,
                first_collection,
                RedeemPositionArgs {
                    condition_id: second_condition.condition_id,
                    index_set: selected,
                    amount: 100,
                },
            ),
            TransactionVersion::V0,
        )
        .unwrap();
    assert_eq!(context.balance(payer, combined_position).amount, 0);
    assert_eq!(context.balance(payer, first_position).amount, 50);
    context
        .send(
            redeem_to_collateral_instruction(
                payer,
                owner_account,
                mint,
                token_program,
                RedeemPositionArgs {
                    condition_id: first_condition.condition_id,
                    index_set: selected,
                    amount: 50,
                },
            ),
            TransactionVersion::V0,
        )
        .unwrap();

    assert_eq!(combined_collection, derive_collection_id(second_collection, first_condition.condition_id, selected).unwrap().collection_id);
    assert_eq!(context.balance(payer, first_position).amount, 0);
    assert_eq!(context.balance(payer, second_position).amount, 0);
    assert_eq!(context.token_amount(owner_account), 75);
    assert_eq!(context.token_amount(vault_address(mint, token_program)), 225);
    assert_within_transaction_limit(&first_residual);
    assert_within_transaction_limit(&first_collateral);
    println!(
        "redeem_position transaction_bytes={residual_transaction_bytes} first_use_cu={} existing_cu={} redeem_to_collateral_cu={}",
        first_residual.compute_units_consumed,
        existing_residual.compute_units_consumed,
        first_collateral.compute_units_consumed
    );
}

#[test]
fn redemption_preserves_multiplicity_and_bounds_each_rounding_step() {
    let mut context = TestContext::new();
    let payer = context.payer.pubkey();
    let token_program = anchor_spl::token::ID;
    let (mint, owner_account) = context.create_funded_collateral(token_program, 100);
    context
        .send(
            register_collateral_instruction(payer, mint, token_program),
            TransactionVersion::V0,
        )
        .unwrap();
    let condition = condition_args(payer, [203; 32], 2);
    context
        .send(
            prepare_condition_instruction(payer, condition.clone()),
            TransactionVersion::V0,
        )
        .unwrap();
    let selected = index_set(&[0]);
    let complement = index_set(&[1]);
    let (parent_collection, parent_position) = prepare_position(
        &mut context,
        mint,
        ROOT_COLLECTION_ID,
        condition.condition_id,
        selected,
    );
    prepare_position(
        &mut context,
        mint,
        ROOT_COLLECTION_ID,
        condition.condition_id,
        complement,
    );
    context
        .send(
            split_from_collateral_instruction(
                payer,
                owner_account,
                mint,
                token_program,
                RootCollateralArgs {
                    condition_id: condition.condition_id,
                    partition: vec![selected, complement],
                    amount: 100,
                },
            ),
            TransactionVersion::V0,
        )
        .unwrap();
    let (_, repeated_position) = prepare_position(
        &mut context,
        mint,
        parent_collection,
        condition.condition_id,
        selected,
    );
    prepare_position(
        &mut context,
        mint,
        parent_collection,
        condition.condition_id,
        complement,
    );
    context
        .send(
            split_position_instruction(
                payer,
                mint,
                parent_collection,
                NativePositionArgs {
                    parent_collection_id: parent_collection,
                    condition_id: condition.condition_id,
                    partition: vec![selected, complement],
                    amount: 100,
                },
            ),
            TransactionVersion::V0,
        )
        .unwrap();
    context
        .send(
            report_payouts_instruction(payer, condition.condition_id, vec![1, 2]),
            TransactionVersion::V0,
        )
        .unwrap();

    let parent_balance_address = balance_address(payer, parent_position);
    let mut parent_account = context.svm.get_account(&parent_balance_address).unwrap();
    let mut parent_balance: PositionBalance = deserialize_account(&parent_account.data);
    parent_balance.amount = u64::MAX;
    parent_account.data = serialize_account(&parent_balance, PositionBalance::SPACE);
    context
        .svm
        .set_account(parent_balance_address, parent_account.clone())
        .unwrap();
    assert!(context
        .send(
            redeem_position_instruction(
                payer,
                mint,
                parent_collection,
                RedeemPositionArgs {
                    condition_id: condition.condition_id,
                    index_set: selected,
                    amount: 3,
                },
            ),
            TransactionVersion::V0,
        )
        .is_err());
    assert_eq!(context.balance(payer, repeated_position).amount, 100);
    parent_balance.amount = 0;
    parent_account.data = serialize_account(&parent_balance, PositionBalance::SPACE);
    context
        .svm
        .set_account(parent_balance_address, parent_account)
        .unwrap();

    context
        .send(
            redeem_position_instruction(
                payer,
                mint,
                parent_collection,
                RedeemPositionArgs {
                    condition_id: condition.condition_id,
                    index_set: selected,
                    amount: 100,
                },
            ),
            TransactionVersion::V0,
        )
        .unwrap();
    assert_eq!(context.balance(payer, repeated_position).amount, 0);
    assert_eq!(context.balance(payer, parent_position).amount, 33);
    let remainder = 100u128 - 33u128 * 3;
    assert!(remainder < 3);

    context
        .send(
            redeem_to_collateral_instruction(
                payer,
                owner_account,
                mint,
                token_program,
                RedeemPositionArgs {
                    condition_id: condition.condition_id,
                    index_set: selected,
                    amount: 33,
                },
            ),
            TransactionVersion::V0,
        )
        .unwrap();
    assert_eq!(context.balance(payer, parent_position).amount, 0);
    assert_eq!(context.token_amount(owner_account), 11);
    assert_eq!(context.token_amount(vault_address(mint, token_program)), 89);
}

#[test]
fn root_redemption_supports_zero_payouts_and_both_token_programs() {
    for token_program in [anchor_spl::token::ID, anchor_spl::token_2022::ID] {
        let mut context = TestContext::new();
        let payer = context.payer.pubkey();
        let (mint, owner_account) = context.create_funded_collateral(token_program, 20);
        context
            .send(
                register_collateral_instruction(payer, mint, token_program),
                TransactionVersion::V0,
            )
            .unwrap();
        let (condition, partition, position_ids) =
            prepare_root_positions(&mut context, mint, 2, payer);
        context
            .send(
                split_from_collateral_instruction(
                    payer,
                    owner_account,
                    mint,
                    token_program,
                    RootCollateralArgs {
                        condition_id: condition.condition_id,
                        partition: partition.clone(),
                        amount: 20,
                    },
                ),
                TransactionVersion::V0,
            )
            .unwrap();
        context
            .send(
                report_payouts_instruction(payer, condition.condition_id, vec![0, 1]),
                TransactionVersion::V0,
            )
            .unwrap();

        context
            .send(
                redeem_to_collateral_instruction(
                    payer,
                    owner_account,
                    mint,
                    token_program,
                    RedeemPositionArgs {
                        condition_id: condition.condition_id,
                        index_set: partition[0],
                        amount: 20,
                    },
                ),
                TransactionVersion::V0,
            )
            .unwrap();
        assert_eq!(context.balance(payer, position_ids[0]).amount, 0);
        assert_eq!(context.token_amount(owner_account), 0);
        assert_eq!(context.token_amount(vault_address(mint, token_program)), 20);

        let winning = context
            .send(
                redeem_to_collateral_instruction(
                    payer,
                    owner_account,
                    mint,
                    token_program,
                    RedeemPositionArgs {
                        condition_id: condition.condition_id,
                        index_set: partition[1],
                        amount: 20,
                    },
                ),
                TransactionVersion::V0,
            )
            .unwrap();
        assert_eq!(context.balance(payer, position_ids[1]).amount, 0);
        assert_eq!(context.token_amount(owner_account), 20);
        assert_eq!(context.token_amount(vault_address(mint, token_program)), 0);
        assert_within_transaction_limit(&winning);
        println!(
            "redeem_to_collateral token_program={token_program} compute_units={}",
            winning.compute_units_consumed
        );
    }
}

#[test]
fn redemption_executes_the_maximum_width_payout_at_runtime() {
    let mut context = TestContext::new();
    let payer = context.payer.pubkey();
    let token_program = anchor_spl::token::ID;
    let (mint, owner_account) = context.create_funded_collateral(token_program, u64::MAX);
    context
        .send(
            register_collateral_instruction(payer, mint, token_program),
            TransactionVersion::V0,
        )
        .unwrap();
    let condition = condition_args(payer, [204; 32], 256);
    context
        .send(
            prepare_condition_instruction(payer, condition.clone()),
            TransactionVersion::V0,
        )
        .unwrap();
    let selected = IndexSet {
        words: [u64::MAX, u64::MAX, u64::MAX, u64::MAX >> 1],
    };
    let complement = index_set(&[255]);
    let (_, selected_position) = prepare_position(
        &mut context,
        mint,
        ROOT_COLLECTION_ID,
        condition.condition_id,
        selected,
    );
    prepare_position(
        &mut context,
        mint,
        ROOT_COLLECTION_ID,
        condition.condition_id,
        complement,
    );
    context
        .send(
            split_from_collateral_instruction(
                payer,
                owner_account,
                mint,
                token_program,
                RootCollateralArgs {
                    condition_id: condition.condition_id,
                    partition: vec![selected, complement],
                    amount: u64::MAX,
                },
            ),
            TransactionVersion::V0,
        )
        .unwrap();
    let mut payout_numerators = vec![u64::MAX; 255];
    payout_numerators.push(1);
    context
        .send(
            report_payouts_instruction(payer, condition.condition_id, payout_numerators),
            TransactionVersion::V1,
        )
        .unwrap();

    let metadata = context
        .send(
            redeem_to_collateral_instruction(
                payer,
                owner_account,
                mint,
                token_program,
                RedeemPositionArgs {
                    condition_id: condition.condition_id,
                    index_set: selected,
                    amount: u64::MAX,
                },
            ),
            TransactionVersion::V0,
        )
        .unwrap();
    assert_eq!(context.balance(payer, selected_position).amount, 0);
    assert_eq!(context.token_amount(owner_account), u64::MAX - 1);
    assert_eq!(context.token_amount(vault_address(mint, token_program)), 1);
    assert_within_transaction_limit(&metadata);
    println!(
        "redeem_to_collateral maximum_width_compute_units={}",
        metadata.compute_units_consumed
    );
}

#[test]
fn invalid_redemptions_leave_source_and_collateral_unchanged() {
    let mut context = TestContext::new();
    let payer = context.payer.pubkey();
    let token_program = anchor_spl::token::ID;
    let mint = context.create_mint(token_program, Some(payer));
    let owner_account =
        CreateAssociatedTokenAccount::new(&mut context.svm, &context.payer, &mint)
            .token_program_id(&token_program)
            .send()
            .unwrap();
    MintTo::new(
        &mut context.svm,
        &context.payer,
        &mint,
        &owner_account,
        20,
    )
    .token_program_id(&token_program)
    .send()
    .unwrap();
    context
        .send(
            register_collateral_instruction(payer, mint, token_program),
            TransactionVersion::V0,
        )
        .unwrap();
    let (condition, partition, position_ids) = prepare_root_positions(&mut context, mint, 2, payer);
    context
        .send(
            split_from_collateral_instruction(
                payer,
                owner_account,
                mint,
                token_program,
                RootCollateralArgs {
                    condition_id: condition.condition_id,
                    partition: partition.clone(),
                    amount: 20,
                },
            ),
            TransactionVersion::V0,
        )
        .unwrap();

    let redeem = |amount| {
        redeem_to_collateral_instruction(
            payer,
            owner_account,
            mint,
            token_program,
            RedeemPositionArgs {
                condition_id: condition.condition_id,
                index_set: partition[0],
                amount,
            },
        )
    };
    assert!(context.send(redeem(1), TransactionVersion::V0).is_err());
    context
        .send(
            report_payouts_instruction(payer, condition.condition_id, vec![1, 1]),
            TransactionVersion::V0,
        )
        .unwrap();
    assert!(context.send(redeem(21), TransactionVersion::V0).is_err());

    let mut wrong_source = redeem(1);
    wrong_source.accounts[7] = AccountMeta::new_readonly(position_address(position_ids[1]), false);
    wrong_source.accounts[8] = AccountMeta::new(balance_address(payer, position_ids[1]), false);
    assert!(context
        .send(wrong_source, TransactionVersion::V0)
        .is_err());

    FreezeAccount::new(&mut context.svm, &context.payer, &mint)
        .token_program_id(&token_program)
        .send()
        .unwrap();
    assert!(context.send(redeem(10), TransactionVersion::V0).is_err());
    assert_eq!(context.balance(payer, position_ids[0]).amount, 20);
    assert_eq!(context.balance(payer, position_ids[1]).amount, 20);
    assert_eq!(context.token_amount(owner_account), 0);
    assert_eq!(context.token_amount(vault_address(mint, token_program)), 20);
}

#[test]
fn invalid_root_transitions_leave_tokens_and_balances_unchanged() {
    let mut context = TestContext::new();
    let payer = context.payer.pubkey();
    let token_program = anchor_spl::token::ID;
    let (mint, owner_account) = context.create_funded_collateral(token_program, 100);
    context
        .send(
            register_collateral_instruction(payer, mint, token_program),
            TransactionVersion::V0,
        )
        .unwrap();
    let (condition, partition, position_ids) = prepare_root_positions(
        &mut context,
        mint,
        3,
        Pubkey::new_from_array([3; 32]),
    );
    let vault = vault_address(mint, token_program);

    let invalid_cases = [
        RootCollateralArgs {
            condition_id: condition.condition_id,
            partition: partition.clone(),
            amount: 0,
        },
        RootCollateralArgs {
            condition_id: condition.condition_id,
            partition: partition[..2].to_vec(),
            amount: 1,
        },
        RootCollateralArgs {
            condition_id: condition.condition_id,
            partition: vec![
                partition[0],
                IndexSet {
                    words: [3, 0, 0, 0],
                },
                partition[2],
            ],
            amount: 1,
        },
        RootCollateralArgs {
            condition_id: condition.condition_id,
            partition: partition.clone(),
            amount: 101,
        },
    ];
    for args in invalid_cases {
        assert!(context
            .send(
                split_from_collateral_instruction(
                    payer,
                    owner_account,
                    mint,
                    token_program,
                    args,
                ),
                TransactionVersion::V0,
            )
            .is_err());
        assert_eq!(context.token_amount(owner_account), 100);
        assert_eq!(context.token_amount(vault), 0);
        assert!(position_ids
            .iter()
            .all(|position_id| context.balance(payer, *position_id).amount == 0));
    }
    let missing_pair_args = RootCollateralArgs {
        condition_id: condition.condition_id,
        partition: partition.clone(),
        amount: 1,
    };
    let mut missing_pair = split_from_collateral_instruction(
        payer,
        owner_account,
        mint,
        token_program,
        missing_pair_args,
    );
    missing_pair.accounts.pop();
    assert!(context.send(missing_pair, TransactionVersion::V0).is_err());

    let valid_args = RootCollateralArgs {
        condition_id: condition.condition_id,
        partition: partition.clone(),
        amount: 50,
    };
    context
        .send(
            split_from_collateral_instruction(
                payer,
                owner_account,
                mint,
                token_program,
                valid_args.clone(),
            ),
            TransactionVersion::V0,
        )
        .unwrap();

    let first_balance_address = balance_address(payer, position_ids[0]);
    let mut first_balance_account = context.svm.get_account(&first_balance_address).unwrap();
    let mut first_balance: PositionBalance = deserialize_account(&first_balance_account.data);
    first_balance.amount = u64::MAX;
    first_balance_account.data = serialize_account(&first_balance, PositionBalance::SPACE);
    context
        .svm
        .set_account(first_balance_address, first_balance_account.clone())
        .unwrap();
    assert!(context
        .send(
            split_from_collateral_instruction(
                payer,
                owner_account,
                mint,
                token_program,
                RootCollateralArgs {
                    amount: 1,
                    ..valid_args.clone()
                },
            ),
            TransactionVersion::V0,
        )
        .is_err());
    assert_eq!(context.token_amount(owner_account), 50);
    assert_eq!(context.token_amount(vault), 50);
    first_balance.amount = 50;
    first_balance_account.data = serialize_account(&first_balance, PositionBalance::SPACE);
    context
        .svm
        .set_account(first_balance_address, first_balance_account)
        .unwrap();

    let mut insufficient_balance_account = context.svm.get_account(&first_balance_address).unwrap();
    let mut insufficient_balance: PositionBalance =
        deserialize_account(&insufficient_balance_account.data);
    insufficient_balance.amount = 49;
    insufficient_balance_account.data =
        serialize_account(&insufficient_balance, PositionBalance::SPACE);
    context
        .svm
        .set_account(first_balance_address, insufficient_balance_account.clone())
        .unwrap();
    assert!(context
        .send(
            merge_to_collateral_instruction(
                payer,
                owner_account,
                mint,
                token_program,
                valid_args.clone(),
            ),
            TransactionVersion::V0,
        )
        .is_err());
    insufficient_balance.amount = 50;
    insufficient_balance_account.data =
        serialize_account(&insufficient_balance, PositionBalance::SPACE);
    context
        .svm
        .set_account(first_balance_address, insufficient_balance_account)
        .unwrap();

    let insufficient_merge = RootCollateralArgs {
        amount: 51,
        ..valid_args.clone()
    };
    assert!(context
        .send(
            merge_to_collateral_instruction(
                payer,
                owner_account,
                mint,
                token_program,
                insufficient_merge,
            ),
            TransactionVersion::V0,
        )
        .is_err());

    let mut wrong_position = merge_to_collateral_instruction(
        payer,
        owner_account,
        mint,
        token_program,
        valid_args.clone(),
    );
    wrong_position.accounts.swap(8, 10);
    assert!(context
        .send(wrong_position, TransactionVersion::V0)
        .is_err());

    let mut duplicate = merge_to_collateral_instruction(
        payer,
        owner_account,
        mint,
        token_program,
        valid_args,
    );
    duplicate.accounts[9] = duplicate.accounts[11].clone();
    assert!(context.send(duplicate, TransactionVersion::V0).is_err());

    let mut wrong_vault = merge_to_collateral_instruction(
        payer,
        owner_account,
        mint,
        token_program,
        RootCollateralArgs {
            condition_id: condition.condition_id,
            partition,
            amount: 1,
        },
    );
    wrong_vault.accounts[5] = AccountMeta::new(owner_account, false);
    assert!(context.send(wrong_vault, TransactionVersion::V0).is_err());

    assert_eq!(context.token_amount(owner_account), 50);
    assert_eq!(context.token_amount(vault), 50);
    assert!(position_ids
        .iter()
        .all(|position_id| context.balance(payer, *position_id).amount == 50));
}

#[test]
fn frozen_token_cpi_rolls_back_root_merge() {
    let mut context = TestContext::new();
    let payer = context.payer.pubkey();
    let token_program = anchor_spl::token::ID;
    let mint = context.create_mint(token_program, Some(payer));
    let owner_account =
        CreateAssociatedTokenAccount::new(&mut context.svm, &context.payer, &mint)
            .token_program_id(&token_program)
            .send()
            .unwrap();
    MintTo::new(
        &mut context.svm,
        &context.payer,
        &mint,
        &owner_account,
        100,
    )
    .token_program_id(&token_program)
    .send()
    .unwrap();
    context
        .send(
            register_collateral_instruction(payer, mint, token_program),
            TransactionVersion::V0,
        )
        .unwrap();
    let (condition, partition, position_ids) = prepare_root_positions(
        &mut context,
        mint,
        2,
        Pubkey::new_from_array([2; 32]),
    );
    let args = RootCollateralArgs {
        condition_id: condition.condition_id,
        partition,
        amount: 40,
    };
    context
        .send(
            split_from_collateral_instruction(
                payer,
                owner_account,
                mint,
                token_program,
                args.clone(),
            ),
            TransactionVersion::V0,
        )
        .unwrap();
    FreezeAccount::new(&mut context.svm, &context.payer, &mint)
        .token_program_id(&token_program)
        .send()
        .unwrap();

    assert!(context
        .send(
            merge_to_collateral_instruction(
                payer,
                owner_account,
                mint,
                token_program,
                args,
            ),
            TransactionVersion::V0,
        )
        .is_err());
    assert_eq!(context.token_amount(owner_account), 60);
    assert_eq!(context.token_amount(vault_address(mint, token_program)), 40);
    assert!(position_ids
        .iter()
        .all(|position_id| context.balance(payer, *position_id).amount == 40));
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
