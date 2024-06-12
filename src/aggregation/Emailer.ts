import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

export class Emailer {
  private sesClient: SESClient;
  private source: string;

  constructor(sesClient: SESClient, source: string) {
    this.sesClient = sesClient;
    this.source = source;
  }

  async sendEmail(to: string, subject: string, body: string) {
    const command = new SendEmailCommand({
      Destination: {
        ToAddresses: [to],
      },
      Message: {
        Subject: {
          Charset: "UTF-8",
          Data: subject,
        },
        Body: {
          Text: {
            Charset: "UTF-8",
            Data: body,
          },
        },
      },
      Source: this.source,
    });
    const response = await this.sesClient.send(command);
    console.log("Sent email to ", to, response);
  }
}
