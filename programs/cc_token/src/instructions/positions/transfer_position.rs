use anchor_lang::{
    prelude::*,
    system_program::{self, Allocate, Assign, CreateAccount, Transfer},
};

use crate::{
    constants::{BALANCE_SEED, POSITION_SEED, STATE_VERSION},
    events::PositionTransferred,
    instructions::positions::position_balance::{validate_balance, validate_position_identity},
    prelude::*,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct TransferPositionArgs {
    pub amount: u64,
}

#[derive(Accounts)]
pub struct TransferPosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: The recipient identifies a balance PDA and does not authorize the transfer.
    pub recipient: UncheckedAccount<'info>,
    #[account(
        seeds = [POSITION_SEED, position.position_id.as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, PositionDefinition>,
    #[account(
        mut,
        seeds = [BALANCE_SEED, owner.key().as_ref(), position.position_id.as_ref()],
        bump = source_balance.bump
    )]
    pub source_balance: Account<'info, PositionBalance>,
    pub system_program: Program<'info, System>,
}

pub fn transfer_position<'info>(
    ctx: Context<'info, TransferPosition<'info>>,
    args: TransferPositionArgs,
) -> CcTokenResult {
    require!(args.amount > 0, CcTokenError::ZeroAmount);
    require_keys_neq!(
        ctx.accounts.owner.key(),
        ctx.accounts.recipient.key(),
        CcTokenError::SelfTransfer
    );
    require!(
        ctx.remaining_accounts.len() == 1,
        CcTokenError::InvalidTransferDestination
    );
    validate_position_identity(&ctx.accounts.position.key(), &ctx.accounts.position)?;
    validate_balance(
        &ctx.accounts.source_balance.key(),
        &ctx.accounts.source_balance,
        ctx.accounts.owner.key(),
        ctx.accounts.position.position_id,
    )?;

    require!(
        ctx.accounts.source_balance.amount >= args.amount,
        CcTokenError::InsufficientPositionBalance
    );

    let destination_account = &ctx.remaining_accounts[0];
    require!(
        destination_account.is_writable,
        CcTokenError::AccountNotWritable
    );
    let (destination_address, destination_bump) = Pubkey::find_program_address(
        &[
            BALANCE_SEED,
            ctx.accounts.recipient.key().as_ref(),
            ctx.accounts.position.position_id.as_ref(),
        ],
        &crate::ID,
    );
    require_keys_eq!(
        destination_account.key(),
        destination_address,
        CcTokenError::PositionBalanceMismatch
    );

    let requires_initialization = destination_account.owner == &System::id();
    let mut destination_balance = if requires_initialization {
        require!(
            destination_account.data_is_empty(),
            CcTokenError::PositionBalanceMismatch
        );
        PositionBalance {
            version: STATE_VERSION,
            owner: ctx.accounts.recipient.key(),
            position_id: ctx.accounts.position.position_id,
            amount: 0,
            bump: destination_bump,
        }
    } else {
        require_keys_eq!(
            *destination_account.owner,
            crate::ID,
            CcTokenError::PositionBalanceMismatch
        );
        let balance =
            PositionBalance::try_deserialize(&mut destination_account.try_borrow_data()?.as_ref())?;
        validate_balance(
            &destination_account.key(),
            &balance,
            ctx.accounts.recipient.key(),
            ctx.accounts.position.position_id,
        )?;
        balance
    };

    let source_amount = ctx
        .accounts
        .source_balance
        .amount
        .checked_sub(args.amount)
        .ok_or_else(|| error!(CcTokenError::InsufficientPositionBalance))?;
    destination_balance.amount = destination_balance
        .amount
        .checked_add(args.amount)
        .ok_or_else(|| error!(CcTokenError::ArithmeticOverflow))?;

    if requires_initialization {
        let bump_seed = [destination_bump];
        let signer_seeds = [
            BALANCE_SEED,
            ctx.accounts.recipient.key.as_ref(),
            ctx.accounts.position.position_id.as_ref(),
            bump_seed.as_ref(),
        ];
        initialize_destination_balance(
            &ctx.accounts.owner,
            destination_account,
            &ctx.accounts.system_program,
            &signer_seeds,
        )?;
    }

    ctx.accounts.source_balance.amount = source_amount;
    let mut destination_data = destination_account.try_borrow_mut_data()?;
    destination_balance.try_serialize(&mut &mut destination_data[..])?;

    emit!(PositionTransferred {
        source_owner: ctx.accounts.owner.key(),
        destination_owner: ctx.accounts.recipient.key(),
        position_id: ctx.accounts.position.position_id,
        amount: args.amount,
    });
    Ok(())
}

fn initialize_destination_balance<'info>(
    payer: &Signer<'info>,
    destination: &AccountInfo<'info>,
    system_program_account: &Program<'info, System>,
    signer_seeds: &[&[u8]],
) -> CcTokenResult {
    let rent_exempt_lamports = Rent::get()?.minimum_balance(PositionBalance::SPACE);
    if destination.lamports() == 0 {
        return system_program::create_account(
            CpiContext::new_with_signer(
                system_program_account.key(),
                CreateAccount {
                    from: payer.to_account_info(),
                    to: destination.clone(),
                },
                &[signer_seeds],
            ),
            rent_exempt_lamports,
            PositionBalance::SPACE as u64,
            &crate::ID,
        );
    }

    let required_lamports = rent_exempt_lamports.saturating_sub(destination.lamports());
    if required_lamports > 0 {
        system_program::transfer(
            CpiContext::new(
                system_program_account.key(),
                Transfer {
                    from: payer.to_account_info(),
                    to: destination.clone(),
                },
            ),
            required_lamports,
        )?;
    }
    system_program::allocate(
        CpiContext::new_with_signer(
            system_program_account.key(),
            Allocate {
                account_to_allocate: destination.clone(),
            },
            &[signer_seeds],
        ),
        PositionBalance::SPACE as u64,
    )?;
    system_program::assign(
        CpiContext::new_with_signer(
            system_program_account.key(),
            Assign {
                account_to_assign: destination.clone(),
            },
            &[signer_seeds],
        ),
        &crate::ID,
    )
}
