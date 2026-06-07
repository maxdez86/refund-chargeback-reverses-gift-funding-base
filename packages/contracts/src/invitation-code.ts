import { z } from "zod";

export const INVITATION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const INVITATION_CODE_DIGITS = "23456789";
export const INVITATION_CODE_REGEX = /^[A-HJ-NP-Z]{2}[2-9]{4}$/;

export const InvitationCodeSchema = z.string().regex(INVITATION_CODE_REGEX);
