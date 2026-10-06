use anchor_lang::prelude::*;

pub type CcTokenResult<T = ()> = Result<T>;

pub use crate::errors::CcTokenError;
