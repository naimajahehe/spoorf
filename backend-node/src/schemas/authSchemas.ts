import { z } from 'zod';

export const LoginBodySchema = z.object({
    email: z.string().optional(),
    password: z.string().optional(),
    token: z.string().optional(),
    cloudUrl: z.string().optional()
}).refine(data => Boolean(data.email || data.token), {
    message: 'Email atau token lisensi diperlukan'
});

export const ActivateBodySchema = z.object({
    key: z.string({
        required_error: 'Kode lisensi diperlukan',
        invalid_type_error: 'Kode lisensi diperlukan'
    }).min(1, 'Kode lisensi diperlukan')
});
