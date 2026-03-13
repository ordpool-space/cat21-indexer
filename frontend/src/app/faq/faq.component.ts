import { AsyncPipe, KeyValuePipe, NgClass, NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LetModule } from '@rx-angular/template/let';
import { PushModule } from '@rx-angular/template/push';

import { LoadingIndicatorComponent } from '../layout/loading-indicator/loading-indicator.component';
import { ParseMarkdownPipe } from '../parse-markdown.pipe';
import { NoSanitizePipe } from '../no-sanitize.pipe';

interface Faq {
  question: string;
  answer: string;
}

@Component({
  selector: 'app-faq',
  templateUrl: './faq.component.html',
  styleUrls: ['./faq.component.scss'],
  standalone: true,
  imports: [
    AsyncPipe,
    LoadingIndicatorComponent,
    NgIf,
    ParseMarkdownPipe,
    RouterLink,
    NoSanitizePipe,
    LetModule,
    PushModule,
    NgFor,
    KeyValuePipe,
    NgClass
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FaqComponent {

  activeIndex = 0;

  faqs: Faq[] = [
    {
      question: 'What is the purpose of the "Ordinal Cats" project?',
      answer: `This project allows anyone to create art on the Bitcoin blockchain. The artistic process consists of selecting suitable images that are already present on the chain.<br><br>Additionally this project seeks to fully utilize the technical possibilities around Ordinals and Inscriptions. Normally, collections are pre-generated, and all digital artifacts are known from the start. The buyer acquires one of the artifacts without any possibility of intervening in the process. We want to reverse this process - the art collector becomes the curator and chooses the images to be added to the cube. __It's a bit like fx(params), but for Bitcoin!__ Furthermore, the cube artifacts have been generated with the maximum possible technical compression. Each individual inscription stores data with exactly __557 bytes__ in size, making it incredibly efficient. This efficiency is made possible through the use of recursive inscriptions.`
    },
    {
      question: 'Where can I find suitable inscriptions with images?',
      answer: `Your best bet is to search at [Magic Eden](https://magiceden.io/ordinals), [Ord.io](https://www.ord.io/?contentType=image) or [Hiro](https://ordinals.hiro.so/explore?f=image). Make sure that none of the sides of your cube turns black, that would be a pity. For animated GIFs, only the first frame will be displayed.`
    },
    // {
    //   question: "What are Bitcoin Ordinals?",
    //   answer: "Ordinals are digital assets inscribed on a satoshi, the lowest denomination of a Bitcoin (BTC). Ordinals only exist onchain and are totally immutable, meaning they cannot be altered in any way."
    // },
    // {
    //   question: "What is the Ordinal theory?",
    //   answer: "The Ordinal theory offers a unique method to track and potentially assign value to individual satoshis, even if they are not officially recorded on the blockchain."
    // },
    // {
    //   question: "What are inscriptions in the context of Bitcoin?",
    //   answer: "Inscriptions refer to a novel method of storing data in the Bitcoin blockchain. Each inscription is assigned to an individual Satoshi. They represent a newly invented functionality within the Bitcoin ecosystem."
    // },
    // {
    //   question: "How is ownership of inscriptions changed?",
    //   answer: "Ownership of inscriptions is linked to the individual owner of the Satoshi. The ownership can be transferred by sending it to any Bitcoin address. The recipient of the transfer becomes the new owner of the Satoshi and its inscription."
    // },
    {
      question: 'How do I create a cube?',
      answer: 'You can create an ordinal cube by entering six Inscription IDs and your receiving address to the form. Each cube, with its six sides, displays the image of the respective inscription. After submitting the form, you are required to cover the costs of creating the inscription through a Bitcoin payment.'
    },
    {
      question: 'What is the TXIDiN format?',
      answer: 'Inscription IDs are of the form TXID<strong>i</strong>N, where TXID is the transaction ID of the reveal transaction, and N is the index of the inscription in the reveal transaction. The small letter __"i"__ separates both entries. Please provide six Inscription IDs to create a new cube!'
    },
    {
      question: 'What is a taproot address?',
      answer: 'A taproot address is a type of Bitcoin address that starts with "bc1p"... . This type of address is best suited to receive Ordinals. Please only use a wallet specifically designed for Ordinals, for example, the Xverse wallet (see below).'
    },
    {
      question: 'How do I pay for my cube?',
      answer: 'You can pay for your cube directly with either Lightning (instant) or by paying onchain with Bitcoin (BTC). It\' super simple!'
    },
    {
      question: 'Can I make an onchain payment via a centralized exchange like Coinbase or Binance?',
      answer: 'That is not a problem. However, please make sure that the exact amount of satoshis reaches us. This means the satoshis to be paid PLUS all additional fees.'
    },
    {
      question: 'What happens after I pay?',
      answer: 'Once your payment is confirmed, your cube is automatically inscribed onto the Bitcoin blockchain and sent to your wallet.'
    },
    {
      question: 'How is the data of my cube stored?',
      answer: 'The data for your cube is fully stored on the Bitcoin blockchain ("onchain") and remains unchangeable forever.'
      //  At least almost forever. Since the data is stored in the (segregated) witness data area, it could theoretically be lost if all nodes were to prune their data. But this is really very, very unlikely. After all, Bitcoin is maximally decentralized. There only needs to be one node operator on this planet who keeps the data.
    },
    // {
    //   question: 'Does this website store any data? What about privacy?',
    //   answer: 'We absolutely do not store anything. No cookies, no tracking, no log files. We host on a static web server (Cloudflare Pages). The backend also does not store any data and doesn\'t even have a database, its filesystem is ephemeral. We really know nothing about you. If you refresh the page, everything is gone. __The only storage is the Bitcoin blockchain!__'
    // },
    {
      question: 'Which wallet should I use to manage my Ordinals?',
      answer: 'We really like the Xverse wallet from [www.xverse.app](https://www.xverse.app/). Anyone who has used MetaMask before will feel right at home. It is a __non-custodial__ wallet, you are in full control of your funds.'
    },
    {
      question: 'Which wallet can I use for quick and easy ⚡️ Lightning payments?',
      answer: 'There are a number of excellent Lightning wallets, and our recommendation is the Phoenix Wallet from [phoenix.acinq.co](https://phoenix.acinq.co/). Phoenix has been designed for less technical users. Phoenix takes care of everything under the hood and you will barely notice anything, except that your payments are faster and cheaper. It is a __non-custodial__ wallet, you are in full control of your funds.'
    },
    {
      question: 'What is the "utility" of this project?',
      answer: `There is no utility. This is a digital art experiment!`
    },
    {
      question: 'Positioning of the cube in the world space',
      answer:
`#### What is the world space?
The world space is a global, fixed coordinate system in a 3D scene. The origin (0,0,0) of our world space is by default at the center of the scene.

#### How is our cube positioned in the world space?
In our setup, the cube is positioned at the origin (0,0,0) of the world space. This means the cube's center is aligned with the center of the scene.

#### How is the world space oriented?
The y-axis is the up direction, and the x and z axes form a horizontal plane:

* The positive x-axis points to the right.
* The positive y-axis points up.
* The positive z-axis points out of the screen towards the viewer.

However, in our setup, we've adjusted the camera to look towards the positive z-axis, so:

* The positive z-axis points into the screen, away from the viewer.
* The negative z-axis points out of the screen, towards the viewer.

<img src="/assets/coordinate_system_cube.png" width="50%">

<br><br>

#### Where is the camera in relation to the cube?

Our camera is positioned on the positive z-axis, at a slightly elevated position. This means the camera is looking down towards the cube from in front of the screen.

<img src="/assets/coordinate_system.svg" width="50%">

<br><br>

#### How is the light positioned in the scene?
We have two lights in our scene:

1. A point light positioned directly above the cube along the y-axis, which casts shadows.
2. A point light positioned in front of the cube along the positive z-axis, which provides additional illumination.
`
    },
    {
      question: 'How can I stop the animation?',
      answer: 'You can stop the animation by pressing the \'p\' key on your keyboard. To resume the animation, press the \'p\' key again.'
    },
  ];

  toggle(index: number) {
    this.activeIndex = this.activeIndex === index ? -1 : index;
  }

}
