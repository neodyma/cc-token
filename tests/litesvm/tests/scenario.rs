use std::path::PathBuf;

use anchor_lang::{
    prelude::{AccountDeserialize, AccountSerialize, Pubkey, System},
    Id, InstructionData, ToAccountMetas,
};
use cc_token::{
    accounts,
    constants::{POSITION_SEED, SCENARIO_SEED, STATE_VERSION},
    instruction,
    instructions::definitions::{RegisterScenarioArgs, UpdateScenarioNameArgs},
    state::{PositionDefinition, ScenarioDefinition},
    ID,
};
use litesvm::{types::TransactionMetadata, LiteSVM};
use solana_account::Account;
use solana_address::Address;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::{v0, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

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
    ) -> Result<TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
        self.svm.expire_blockhash();
        let message = VersionedMessage::V0(
            v0::Message::try_compile(
                &self.payer.pubkey(),
                &[instruction],
                &[],
                self.svm.latest_blockhash(),
            )
            .unwrap(),
        );
        let transaction = VersionedTransaction::try_new(message, &[&self.payer]).unwrap();
        self.svm.send_transaction(transaction)
    }

    fn send_with_signer(
        &mut self,
        instruction: Instruction,
        signer: &Keypair,
    ) -> Result<TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
        self.svm.expire_blockhash();
        let message = VersionedMessage::V0(
            v0::Message::try_compile(
                &self.payer.pubkey(),
                &[instruction],
                &[],
                self.svm.latest_blockhash(),
            )
            .unwrap(),
        );
        let transaction = VersionedTransaction::try_new(message, &[&self.payer, signer]).unwrap();
        self.svm.send_transaction(transaction)
    }

    fn store_position(&mut self, position_id: [u8; 32], collection_id: [u8; 32]) {
        let (address, bump) = position_address(position_id);
        let position = PositionDefinition {
            version: STATE_VERSION,
            position_id,
            collateral_mint: Pubkey::new_unique(),
            collection_id,
            bump,
        };
        self.svm
            .set_account(
                address,
                Account {
                    lamports: self
                        .svm
                        .minimum_balance_for_rent_exemption(PositionDefinition::SPACE),
                    data: serialize_account(&position, PositionDefinition::SPACE),
                    owner: ID,
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
    }

    fn scenario(&self, creator: Address, position_id: [u8; 32]) -> ScenarioDefinition {
        deserialize_account(
            &self
                .svm
                .get_account(&scenario_address(creator, position_id).0)
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

fn position_address(position_id: [u8; 32]) -> (Address, u8) {
    Address::find_program_address(&[POSITION_SEED, &position_id], &ID)
}

fn scenario_address(creator: Address, position_id: [u8; 32]) -> (Address, u8) {
    Address::find_program_address(&[SCENARIO_SEED, creator.as_ref(), &position_id], &ID)
}

fn register_scenario_instruction(
    payer: Address,
    creator: Address,
    position_id: [u8; 32],
    name: &str,
) -> Instruction {
    Instruction {
        program_id: ID,
        accounts: accounts::RegisterScenario {
            payer,
            creator,
            anchor_position: position_address(position_id).0,
            scenario: scenario_address(creator, position_id).0,
            system_program: System::id(),
        }
        .to_account_metas(None),
        data: instruction::RegisterScenario {
            args: RegisterScenarioArgs {
                anchor_position_id: position_id,
                name: name.to_owned(),
            },
        }
        .data(),
    }
}

fn update_scenario_name_instruction(
    creator: Address,
    scenario_creator: Address,
    position_id: [u8; 32],
    name: &str,
) -> Instruction {
    Instruction {
        program_id: ID,
        accounts: accounts::UpdateScenarioName {
            creator,
            scenario: scenario_address(scenario_creator, position_id).0,
        }
        .to_account_metas(None),
        data: instruction::UpdateScenarioName {
            args: UpdateScenarioNameArgs {
                name: name.to_owned(),
            },
        }
        .data(),
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

#[test]
fn registers_idempotently_without_a_balance_or_collection_ancestry() {
    let mut context = TestContext::new();
    let creator = context.payer.pubkey();
    let position_id = [41; 32];
    context.store_position(position_id, [99; 32]);
    let instruction =
        register_scenario_instruction(creator, creator, position_id, "SOL/USD at expiry");

    let metadata = context.send(instruction.clone()).unwrap();
    let scenario = context.scenario(creator, position_id);
    assert_eq!(scenario.version, STATE_VERSION);
    assert_eq!(scenario.creator, creator);
    assert_eq!(scenario.anchor_position_id, position_id);
    assert_eq!(scenario.name, "SOL/USD at expiry");
    assert!(scenario.registered_slot > 0);
    assert_eq!(scenario.bump, scenario_address(creator, position_id).1);
    assert!(metadata.compute_units_consumed < 200_000);

    let registered_slot = scenario.registered_slot;
    context.send(instruction).unwrap();
    assert_eq!(
        context.scenario(creator, position_id).registered_slot,
        registered_slot
    );

    assert!(context
        .send(register_scenario_instruction(
            creator,
            creator,
            position_id,
            "Different name",
        ))
        .is_err());
    assert_eq!(
        context.scenario(creator, position_id).name,
        "SOL/USD at expiry"
    );
}

#[test]
fn supports_sponsored_creation_and_creator_only_renaming() {
    let mut context = TestContext::new();
    let payer = context.payer.pubkey();
    let creator = Keypair::new();
    let attacker = Keypair::new();
    let position_id = [42; 32];
    context.store_position(position_id, [100; 32]);

    context
        .send_with_signer(
            register_scenario_instruction(payer, creator.pubkey(), position_id, "Original"),
            &creator,
        )
        .unwrap();
    context
        .send_with_signer(
            update_scenario_name_instruction(
                creator.pubkey(),
                creator.pubkey(),
                position_id,
                "Renamed",
            ),
            &creator,
        )
        .unwrap();
    assert_eq!(
        context.scenario(creator.pubkey(), position_id).name,
        "Renamed"
    );

    assert!(context
        .send_with_signer(
            update_scenario_name_instruction(
                attacker.pubkey(),
                creator.pubkey(),
                position_id,
                "Hijacked",
            ),
            &attacker,
        )
        .is_err());
    assert_eq!(
        context.scenario(creator.pubkey(), position_id).name,
        "Renamed"
    );
}

#[test]
fn rejects_invalid_names_without_creating_scenarios() {
    let mut context = TestContext::new();
    let creator = context.payer.pubkey();
    let position_id = [43; 32];
    context.store_position(position_id, [101; 32]);

    for name in ["", " padded", "line\nbreak", &"a".repeat(65)] {
        assert!(context
            .send(register_scenario_instruction(
                creator,
                creator,
                position_id,
                name,
            ))
            .is_err());
        assert!(context
            .svm
            .get_account(&scenario_address(creator, position_id).0)
            .is_none());
    }
}
