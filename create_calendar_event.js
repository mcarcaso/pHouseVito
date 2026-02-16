#!/usr/bin/env node

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

// Load credentials
const SECRETS = JSON.parse(fs.readFileSync('./user/secrets.json', 'utf8'));
const CLIENT_CREDENTIALS = JSON.parse(SECRETS.GOOGLE_CLIENT_SECRET_JSON);
const TOKENS = JSON.parse(SECRETS.GOOGLE_TOKENS_JSON);

async function createEvent() {
    try {
        // Set up OAuth2 client
        const oauth2Client = new google.auth.OAuth2(
            CLIENT_CREDENTIALS.web.client_id,
            CLIENT_CREDENTIALS.web.client_secret,
            CLIENT_CREDENTIALS.web.redirect_uris[0]
        );

        oauth2Client.setCredentials(TOKENS);

        // Create Calendar API instance
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        // Event details
        const event = {
            'summary': 'Battle Test CC',
            'start': {
                'dateTime': '2026-02-20T11:00:00-05:00', // Feb 20, 2026 at 11am EST
                'timeZone': 'America/New_York'
            },
            'end': {
                'dateTime': '2026-02-20T12:00:00-05:00', // 1 hour duration
                'timeZone': 'America/New_York'
            },
            'attendees': [
                { 'email': 'mikecarcasole@gmail.com' }
            ]
        };

        console.log('Creating calendar event...');
        const response = await calendar.events.insert({
            calendarId: 'primary',
            resource: event,
            sendUpdates: 'all'
        });

        console.log(`Event created successfully!`);
        console.log(`Event ID: ${response.data.id}`);
        console.log(`Event Link: ${response.data.htmlLink}`);
        
        return response.data;
    } catch (error) {
        console.error('Error creating event:', error.message);
        if (error.response) {
            console.error('Response:', error.response.data);
        }
        throw error;
    }
}

// Run it
createEvent().catch(console.error);