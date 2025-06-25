import {gql, useApolloClient, ApolloCache, FetchResult} from '@apollo/client';
import React, {useEffect, useRef, useState} from 'react';
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  View,
  ViewToken,
  TouchableWithoutFeedback,
} from 'react-native';
import ScreenLayout from '../components/ScreenLayout';
import styled from 'styled-components/native';
import {useForm} from 'react-hook-form';
import Icon from 'react-native-vector-icons/Ionicons';
import useMe from '../hooks/useMe';
import {useCallback} from 'react';
import {colors} from '../colors';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {RootStackParamList} from '../shared/shared.types';
import {
  Message,
  SeeRoomQuery,
  useReadMessageMutation,
  useSeeRoomQuery,
  useSendMessageMutation,
} from '../generated/graphql';
import {ROOM_UPDATES} from '../documents/subscriptions/roomUpdates.subscription';
import {useTheme} from 'styled-components';

type RoomProps = NativeStackScreenProps<RootStackParamList, 'EachRoom'>;

const NEW_MESSAGE_FRAGMENT = gql`
  fragment NewMessage on Message {
    id
    payload
    user {
      id
      username
      avatar
    }
    read
  }
`;

interface MessageContainerProps {
  outGoing?: boolean;
}

const MessageContainer = styled.View<MessageContainerProps>`
  padding: 0px 10px;
  flex-direction: ${props => (props.outGoing ? 'row-reverse' : 'row')};
  align-items: flex-end;
`;

const Author = styled.View``;

const Avatar = styled.Image`
  height: 20px;
  width: 20px;
  border-radius: 25px;
`;

const IconContainer = styled.View`
  width: 20px;
  height: 20px;
  border-radius: 25px;
  background-color: grey;
  justify-content: center;
  align-items: center;
`;

const MessageItem = styled.Text`
  color: ${props => props.theme.fontColor};
  background-color: ${props => props.theme.separatorLineColor};
  padding: 5px 10px;
  overflow: hidden;
  border-radius: 10px;
  font-size: 16px;
  margin: 0px 10px;
`;

const TextInput = styled.TextInput`
  border: 1px solid ${colors.green};
  padding: 10px 20px;
  color: ${props => props.theme.fontColor};
  border-radius: 1000px;
  width: 90%;
  margin-right: 10px;
`;

const InputContainer = styled.View`
  width: 95%;
  margin-bottom: 50px;
  margin-top: 25px;
  flex-direction: row;
  align-items: center;
`;

const SendButton = styled.TouchableOpacity``;

export default function EachRoom({route, navigation}: RoomProps) {
  const theme = useTheme();
  const {data: meData} = useMe();
  const {register, setValue, handleSubmit, getValues, watch} = useForm();

  const dismissKeyboard = () => {
    Keyboard.dismiss();
  };

  const updateSendMessage = (
    cache: ApolloCache<any>,
    result: FetchResult<any>,
  ) => {
    const {
      data: {
        sendMessage: {ok, id},
      },
    } = result;
    if (ok && meData) {
      const {message} = getValues();
      setValue('message', '');
      const messageObj = {
        id,
        payload: message,
        user: {
          id: meData.me.id,
          username: meData.me.username,
          avatar: meData.me.avatar,
        },
        read: true,
        __typename: 'Message',
      };
      const messageFragment = cache.writeFragment({
        fragment: NEW_MESSAGE_FRAGMENT,
        data: messageObj,
      });

      cache.modify({
        id: `Room:${route.params?.id}`,
        fields: {
          messages(prev) {
            const existingMessage = prev.find(
              (aMessage: any) => aMessage.__ref === messageFragment?.__ref,
            );
            if (existingMessage) {
              console.log('mutation but cahce exists');
              console.log(existingMessage);
              return prev;
            }

            return [...prev, messageFragment];
          },
        },
      });
    }
  };
  const [readMessage] = useReadMessageMutation();
  //here
  const [sendMessageMutation, {loading: sendingMessage}] =
    useSendMessageMutation({
      update: updateSendMessage,
    });

  const {data, loading, subscribeToMore} = useSeeRoomQuery({
    variables: {
      id: route?.params?.id,
    },
    fetchPolicy: 'cache-and-network', // ✅ Uses cache but also fetches updates in the background
  });

  const client = useApolloClient();

  const updateCacheAfterRead = (messageId: number) => {
    client.cache.modify({
      id: `Room:${route.params?.id}`,
      fields: {
        messages(existingMessages) {
          return existingMessages.map((msgRef: any) => {
            const message: Message | null = client.cache.readFragment({
              id: msgRef.__ref,
              fragment: NEW_MESSAGE_FRAGMENT,
            });

            if (message?.id === messageId && !message.read) {
              return {...msgRef, read: true};
            }
            return msgRef;
          });
        },
        unreadTotal(existingUnreadTotal) {
          return Math.max(existingUnreadTotal - 1, 0); // Prevent negative values
        },
      },
    });
  };

  const onMessageRead = async (messageId: number) => {
    try {
      const {data: messageData} = await readMessage({
        variables: {id: messageId},
      });

      if (messageData?.readMessage?.ok) {
        console.log(`✅ Message ${messageId} marked as read`);

        // ✅ Return success status
        return true;
      } else {
        const error = messageData?.readMessage?.error || 'Unknown error';
        console.error(`❌ Failed to mark message as read: ${error}`);
        return false;
      }
    } catch (error) {
      console.error('❌ Failed to mark message as read:', error);
      return false;
    }
  };

  const readMessagesSet = useRef(new Set<number>());

  const onViewableItemsChanged = useCallback(
    ({viewableItems}: {viewableItems: ViewToken[]}) => {
      viewableItems.forEach(({item}) => {
        if (!item.read && item.user.username === route?.params?.talkingTo) {
          if (!readMessagesSet.current.has(item.id)) {
            readMessagesSet.current.add(item.id);
            onMessageRead(item.id).then(success => {
              if (success) {
                updateCacheAfterRead(item.id);
                console.log(
                  `✅ Successfully marked message ${item.id} as read`,
                );
              }
            });
          }
        }
      });
    },
    [route?.params?.talkingTo],
  );

  const isSubscribed = useRef(false);

  useEffect(() => {
    if (data?.seeRoom && !isSubscribed.current) {
      subscribeToMore({
        document: ROOM_UPDATES,
        variables: {id: route?.params?.id},
        updateQuery: (
          prevQuery: SeeRoomQuery,
          {
            subscriptionData,
          }: {subscriptionData: {data?: {roomUpdates?: Message}}},
        ) => {
          if (!subscriptionData.data?.roomUpdates) {
            return prevQuery;
          } // ✅ Ensure roomUpdates exists

          const newMessage = subscriptionData.data.roomUpdates;
          const existingMessages = prevQuery.seeRoom?.messages ?? []; // ✅ Ensure messages is always an array

          if (existingMessages.some(m => m?.id === newMessage.id)) {
            return prevQuery; // Prevent duplicate message addition
          }

          return {
            seeRoom: {
              ...prevQuery.seeRoom,
              id: prevQuery.seeRoom?.id ?? route.params.id, // ✅ Ensure `id` is always defined
              messages: [...existingMessages, newMessage], // ✅ Always spread an array
              __typename: 'Room',
            },
            __typename: 'Query',
          };
        },
      });
      isSubscribed.current = true;
    }
  }, [data]);

  // const [subscribed, setSubscribed] = useState(false);
  // useEffect(() => {
  //   if (data?.seeRoom && !subscribed) {
  //     subscribeToMore({
  //       document: ROOM_UPDATES,
  //       variables: {
  //         id: route?.params?.id,
  //       },
  //       updateQuery: (prevQuery: SeeRoomQuery, options: any): any => {
  //         console.log('updateQuery');
  //         const {
  //           subscriptionData: {
  //             data: {roomUpdates: message},
  //           },
  //         } = options;
  //         if (message.id) {
  //           const messageFragment = client.cache.writeFragment({
  //             fragment: NEW_MESSAGE_FRAGMENT,
  //             data: message,
  //           });
  //           client.cache.modify({
  //             id: `Room:${route.params?.id}`,
  //             fields: {
  //               messages(prev) {
  //                 const existingMessage = prev.find(
  //                   (aMessage: any) =>
  //                     aMessage.__ref === messageFragment?.__ref,
  //                 );
  //                 if (existingMessage) {
  //                   console.log('existingMessage');
  //                   console.log(existingMessage);
  //                   return prev;
  //                 }
  //                 return [...prev, messageFragment];
  //               },
  //             },
  //           });
  //         }
  //       },
  //     });
  //     setSubscribed(true);
  //   }
  // }, [data, subscribed]);

  const onValid = ({message}: any) => {
    if (!sendingMessage) {
      sendMessageMutation({
        variables: {
          payload: message,
          roomId: route?.params?.id,
        },
      });
    }
  };

  useEffect(() => {
    register('message', {required: true});
  }, [register]);

  useEffect(() => {
    console.log('route : ', route);
    navigation.setOptions({
      title: `${route?.params?.talkingTo ? route.params.talkingTo : 'Chat'}`,
    });
    console.log('set completed');
  }, []);

  const renderItem = ({item: message}: any) => (
    <MessageContainer
      outGoing={message.user.username !== route?.params?.talkingTo}>
      <Author>
        {message.user.avatar ? (
          <Avatar source={{uri: message.user.avatar}} />
        ) : (
          <IconContainer>
            <Icon name="person" size={15} color="#ffffff" />
          </IconContainer>
        )}
      </Author>
      <MessageItem>{message.payload}</MessageItem>
    </MessageContainer>
  );
  const messages = [...(data?.seeRoom?.messages ?? [])];
  messages.sort((a: any, b: any) => a.id - b.id);
  messages.reverse();

  return (
    <TouchableWithoutFeedback onPress={dismissKeyboard}>
      {/*<KeyboardAvoidingView*/}
      {/*  style={{*/}
      {/*    flex: 1,*/}
      {/*    flexDirection: 'column',*/}
      {/*    justifyContent: 'center',*/}
      {/*  }}*/}
      {/*  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}*/}
      {/*  keyboardVerticalOffset={55} // Adjust this value as much as header*/}
      {/*  enabled>*/}
      <ScreenLayout loading={loading}>
        <FlatList
          style={{width: '100%', marginVertical: 10}}
          inverted
          ItemSeparatorComponent={() => <View style={{height: 20}} />}
          data={messages}
          showsVerticalScrollIndicator={false}
          keyExtractor={(message: any) => String(message.id)}
          renderItem={renderItem}
          onViewableItemsChanged={onViewableItemsChanged}
        />
        <InputContainer>
          <TextInput
            placeholderTextColor={colors.inactiveGreen}
            placeholder="Write a message..."
            returnKeyLabel="Send Message"
            returnKeyType="send"
            onChangeText={text => setValue('message', text)}
            onSubmitEditing={handleSubmit(onValid)}
            value={watch('message')}
          />
          <SendButton
            onPress={handleSubmit(onValid)}
            disabled={!watch('message')}>
            <Icon
              name="send"
              color={!watch('message') ? colors.inactiveGreen : colors.green}
              size={22}
            />
          </SendButton>
        </InputContainer>
      </ScreenLayout>
      {/*</KeyboardAvoidingView>*/}
    </TouchableWithoutFeedback>
  );
}
