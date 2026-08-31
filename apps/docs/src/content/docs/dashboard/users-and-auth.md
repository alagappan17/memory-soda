---
title: 'Users and sign-in'
description: 'Dashboard login accounts.'
---

Dashboard login accounts.

> **These are operators, not the people being remembered.** A dashboard _user_
> signs in to the UI. A [_dataset_](/concepts/projects-and-datasets/) is the
> memory store for one end user. They are unrelated, and the Users page has
> nothing to do with the Datasets page.

## First sign-in

On an empty database the API seeds one admin account, **`admin` /
`open-sesame`**, the same on every install. Change the password from the
dashboard after first sign-in.

```
[ setup ] admin user "admin" created. Sign in to the dashboard and change the password.
```

The same default on every install is deliberate — it is the Grafana
`admin`/`admin` model. Nobody has to dig a generated password out of a log, and
the dashboard will not let you forget: a **Default password in use** notice
stays in the sidebar until you change it.

### Changing your password

Avatar in the sidebar footer → **Change password**, or click the notice. Enter
the current password and the new one (6+ characters). Other sessions stay
signed in.

### If you lost it

There is no email reset — nothing here can send mail. With database access you
can set any user's password from the shell:

```bash
npm run admin:reset-password -- admin a-new-password
```

Or, if another account exists, sign in with that one and create a replacement
from the Users page.

## The sign-in page

Reached at `/login`, or automatically when you hit any page without a session.

- Username and password, with a show/hide toggle.
- A single error, _Invalid username or password_, for both an unknown user and
  a wrong password.
- **Deep links survive.** Visiting `/datasets?q=abc` while signed out sends you
  to `/login` and back to `/datasets?q=abc` afterwards, query string and hash
  intact.

Sessions last **7 days**.

## Signing out

Click the avatar in the sidebar footer → **Sign out**.

This revokes the session **server-side**, so the token stops working everywhere,
not just in this browser. An expired or revoked session clears itself and returns
you to `/login` on the next request.

## The Users page

Lists every account with its creation date, and allows creating and deleting.

### Creating

| Field    | Rule                     |
| -------- | ------------------------ |
| Username | 1–100 characters, unique |
| Password | 6–200 characters         |

Six characters is a low floor. Nothing enforces complexity, and there is no rate
limiting on sign-in, pick something strong.

Duplicate usernames return `409`, including under concurrent creation.

### Deleting

Two guards, both intended to stop you locking everyone out:

| Blocked                             | Message                              |
| ----------------------------------- | ------------------------------------ |
| Deleting your own account           | _You cannot delete your own account_ |
| Deleting the last remaining account | _Cannot delete the last user_        |

The last-user check runs in a transaction with the user rows locked, so two
simultaneous deletes cannot both pass it.

Deleting a user **cascades to their sessions**, they are signed out immediately.
Nothing else is affected; memory data is untouched.

## What an account can do

**Everything.**

Any signed-in dashboard user can:

- read every dataset in every project
- delete facts
- issue and revoke API keys
- change project settings
- create and delete other users
- delete entire projects

There are **no roles and no permissions**. Only create accounts for people you
would trust with all of that.

## Password storage

```
scrypt$32768$8$3$<salt hex>$<derived key hex>
```

- **scrypt**, per-password random salt, `N=2^15, r=8, p=3`, 32 MiB per
  derivation, one of the configurations on OWASP's list.
- Parameters are **recorded in the hash**, so they can be raised later without
  invalidating existing passwords.
- Hashes in the older `salt:hex` format still verify and are **transparently
  re-hashed** with current parameters on the next successful sign-in.
- Comparison is constant-time, and the unknown-username path performs the same
  work as the known-username path so response latency cannot enumerate accounts.

## Known gaps

| Gap                               | Consequence                                 |
| --------------------------------- | ------------------------------------------- |
| No password change endpoint       | Create a new account, delete the old one    |
| No password reset                 | Recovery requires database access           |
| No roles or permissions           | Every account is a full administrator       |
| No rate limiting on `/auth/login` | Put a proxy in front if exposed             |
| Token in `localStorage`           | Readable by any XSS on the dashboard origin |
| No audit log                      | No record of who deleted what               |

## Next

- [Authentication API](/api/authentication/), the endpoints
- [API keys](/dashboard/api-keys/), the _other_ credential
- [Self-hosting](/operations/self-hosting/)
