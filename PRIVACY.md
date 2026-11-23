# Privacy notice (template)

> **Template, not legal advice.** If you deploy Spensa, replace every `[PLACEHOLDER]`, check it against what your deployment really does, and get advice if you are unsure. Delete this box when done.

_Last updated: [DATE]_

## Who is responsible

The controller of your data is **[CONTROLLER NAME]**, contact **[EMAIL / ADDRESS]**. [If applicable: data protection contact / representative.]

## What data Spensa stores

- **Account**: your email address, a hashed password (or the Google account id if you sign in with Google), account creation time, sign-in sessions.
- **Household data**: the name you give your household and your display name; ingredients, recipes, meal plans, pantry batches and stock adjustments, inventory snapshots, shopping list items; who created, changed or deleted each item and when; the household invite code.
- **Device settings** (theme, density) are kept in your browser only and never sent to the server.
- **Push subscriptions** _(coming soon)_: the push endpoint and keys of the devices you enable notifications on.

Spensa has no analytics or advertising trackers. [Confirm for your deployment.]

## Why we use it (purposes and legal basis)

To provide the service you asked for: sign you in, keep your household's pantry, plans and shopping list in sync between members, and send notifications you enable. Legal basis: performance of a contract / providing the service you requested (Art. 6(1)(b)). [Adjust if you rely on something else, e.g. legitimate interests for security logs.]

## Who processes it

- **Supabase** (database, authentication, edge functions): [REGION of your project].
- **Cloudflare** (hosting of the web app; sees ordinary request data such as IP address).
- **Google (FCM) and Apple (APNs)** _(coming soon)_: deliver web push notifications to your devices.
- **Google** if you use "Continue with Google" for sign-in.

[Add any email provider you configure for sign-up and password mails. Describe international transfers and safeguards if any processor is outside the EEA.]

## How long we keep it

- Account and household data are kept until the account is deleted.
- Deleting something in the app only hides it (so it can be restored and the history stays accurate). Hidden rows are kept until account deletion, then removed with everything else.
- Backups: [describe your Supabase backup retention, if any; deleted data can persist in backups until they expire].

## Your rights

You can ask for access, portability, rectification, erasure, restriction, and you can object, and you can complain to your data protection authority ([NAME OF AUTHORITY]). In the app, **Settings** lets you:

- **Download my data**: a JSON file of your account details and everything your household holds, including hidden (deleted) rows.
- **Delete my account**: permanently deletes your account. If you are the last member, the whole household and all its data are erased. If other members remain, the household keeps its data, your name is removed from it, and the items you created or changed lose their link to you.
- **Edit your name** under Settings, "Your name".

For anything else, contact [CONTROLLER CONTACT].

## Household exemption

If Spensa is run privately by an individual for their own household and invited family or friends, with no commercial or professional activity, the GDPR may not apply to that processing at all (Art. 2(2)(c), "purely personal or household activity"). The exemption does not cover a service offered to the public or to people outside that personal circle, and it does not cover the hosting providers, who remain responsible for their own processing. Decide honestly which applies to you, and keep or drop this notice accordingly.
