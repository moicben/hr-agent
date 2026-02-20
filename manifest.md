#### Detailed Workflow & Execution
1. Search new queries potential queries
2. Extract queries list from input.txt
3. For each query, scrape SERP's results with Serper.dev
	```- Scrap all pages, until no more emails are found (pagination)
- In addition of query parameter, use theses params: "gl": "fr", "hl": "fr", "tbs": "qdr:m" in your Serper.dev API request
- Use SERPER_API_KEY from .env file in your Serper.dev API request
- For each {email_pattern} in config.js scrape all pages, until no more emails are found (pagination)(associated to query)```

4.  Store scraped emails and contact's data in Supabase as proper contact
	```- Store emails and contact's data in Supabase in contacts table
- Use "source_query" column to store the query that generated the contact
- Use "additional_data" column to store all scraped data (title, description, url)
- Use "email" column to store the email that was scraped
- Set the "status" column at "new" for each newly scraped contact
- If no email found, do not store the contact (skip it)
- If email already exists, in contacts table, do not store the contact (skip it)```
5. Start to process each stored contact with "status" column at "new"

	```- Select the older contact with "status" "new" in "contacts" table
- Set the "status" column at "processing" for the selected contact
- Proceed to the next step with the selected contact```
6 Per contact, choose an active identity from Supabase

	```- Refer to column "active" in "identities" table
- Choose the first active identity```
7.  For each contact, etablish a business context
	```- Regroup client and candidate data from the sourced identity and contact to proceed.
- With regrouped data, use CONTEXT_PROMPT to write the business context with OpenAI API request to GPT 4o-mini
- Store the business context in Supabase contacts table in "context" column.```
8. Singularize the email template on base of business context and datas
	```- Use all data form sourced identity to personalize the email content
- Base your copywriting on the business context and the client informations.
- Personalized each data of the EMAIL_TEMPLATE according to the business context and datas.
- Use OpenAI API request to GPT 4o-mini to singularized the email template.
- Store the personalized email content in Supabase emails table following the columns: "object", "content", "cta", "footer", "contact_id"```
9. Send the email with Resend to contact using Resend API
	```- Use the email object, content, cta, footer from the personalized email content to send the email to the contact.
- content, cta, and footer should be integrated in the email content as plain text.
- Use Resend API to send the email to the contact.
- Use the Resend API key from the .env file.
- Update the stauts of the contact in "contacts" table to "processed" or "error" depending on the result of the email sending.
- Update the status of the email in Supabase emails table to "sent" or "error" depending on the result of the email sending.```
10. Repeat the process for the next contact with "status" column at "new"
